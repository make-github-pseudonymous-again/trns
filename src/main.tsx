#!/usr/bin/env node

import process from 'process';
import React, {useState, useEffect} from 'react';
import {render, Box, Text, Newline, useInput, Key} from 'ink';
import LRU from 'lru-cache';
import {useDebounce} from 'use-debounce';
// @ts-expect-error T7016
import {enumerate} from '@iterable-iterator/zip';
// @ts-expect-error T7016
import {filter} from '@iterable-iterator/filter';
// @ts-expect-error T7016
import {map} from '@iterable-iterator/map';

import googleTranslate from '@vitalets/google-translate-api';
import {split as splitText, Syntax} from 'sentence-splitter';

import {parse} from './args';

type Response = googleTranslate.ITranslateResponse;

const _translate_cache = new LRU({
	max: 500,

	maxSize: 50 * 1024 ** 2, // 50 MB
	sizeCalculation: (response: Response) => response.raw.length * 4,

	ttl: 1000 * 60 * 15, // 15 minutes

	allowStale: false,

	updateAgeOnGet: false,
	updateAgeOnHas: false,
});

interface TranslateOptions {
	from?: string;
	to?: string;
}

const translateSentence = async (
	text: string,
	options: TranslateOptions,
): Promise<Response> => {
	const cached = _translate_cache.get(text);
	if (cached !== undefined) return cached;
	let response = await googleTranslate(text, {autoCorrect: true, ...options});
	if (response.from.text.didYouMean) {
		const correctedText = response.from.text.value.replaceAll(
			/\[([a-z]+)]/gi,
			'$1',
		);
		response = await googleTranslate(correctedText, options);
	}

	_translate_cache.set(text, response);
	return response;
};

const splitSentences = (text: string): Iterable<string> =>
	// eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-return
	map(
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		(node: any) => node.raw,
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call
		filter((node: any) => node.type === Syntax.Sentence, splitText(text)),
	);

interface TextNodesProps {
	lang: string;
	text: string;
	color: string;
}

const TextNodes = ({lang, text, color}: TextNodesProps) => {
	const lines = textLines(text);

	const prefix = lang === 'auto' ? '??' : lang;

	return (
		<Box>
			<Box marginRight={1}>
				<Text color={color} dimColor>
					{prefix}
				</Text>
			</Box>
			<Box flexGrow={1} flexDirection="column">
				{lines.map((line, index) => (
					<Box key={index}>
						<Text color={color}>{line}</Text>
					</Box>
				))}
			</Box>
		</Box>
	);
};

interface Translation {
	loading: boolean;
	source: string;
	translation: Response | undefined;
}

const textLines = (text: string): string[] =>
	text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');

interface DebugState {
	input: string;
	key: Key;
}

interface BlockProps {
	from: string;
	to: string;
	text: string;
	translation: Translation[];
}

const Block = ({from, to, text, translation}: BlockProps) => {
	return (
		<Box>
			<Box flexGrow={1} padding={1} flexDirection="column">
				<Box>
					<Text inverse color="yellow" dimColor>
						TRANSLATION
					</Text>
				</Box>
				<Box padding={1} flexDirection="column">
					{translation.map(({loading, source, translation}, index: number) => (
						<Box key={index} marginBottom={1}>
							<Box marginRight={1}>
								<Text bold dimColor>
									{index}
								</Text>
							</Box>
							<Box flexGrow={1} flexDirection="column">
								<TextNodes
									color="blue"
									lang={translation?.from.language.iso ?? from}
									text={source}
								/>
								<TextNodes
									color="magenta"
									lang={to}
									text={(translation?.text ?? '') + (loading ? ' ...' : '')}
								/>
							</Box>
						</Box>
					))}
				</Box>
			</Box>
			<Box flexGrow={1} padding={1} flexDirection="column">
				<Box>
					<Text inverse color="yellow" dimColor>
						INPUT
					</Text>
				</Box>
				<Box padding={1}>
					<TextNodes color="green" lang={from} text={text} />
				</Box>
			</Box>
		</Box>
	);
};

interface AppProps {
	from: string;
	to: string;
	debug: boolean;
}

const App = ({from, to, debug}: AppProps) => {
	const [savedTexts, setSavedTexts] = useState<string[]>([]);
	const [savedTranslations, setSavedTranslations] = useState<Translation[][]>(
		[],
	);
	const [text, setText] = useState('');
	const [errors, setErrors] = useState<Error[]>([]);
	const [debugString, setDebugString] = useState<DebugState | undefined>(
		undefined,
	);
	const [translation, setTranslation] = useState<Translation[]>([]);

	const [debouncedText, {flush}] = useDebounce(text, 1000);

	useInput((input, key) => {
		setDebugString({input, key});
		if (input) {
			if (key.ctrl && input === 's') {
				if (translation.length > 0) {
					setSavedTranslations((translations) =>
						translations.concat([translation.slice()]),
					);
					setSavedTexts((texts) => texts.concat([text]));
					setTranslation([]);
					setText('');
					flush();
				}
			} else {
				setText((value: string) => value + input);
			}
		} else if (key.delete || key.backspace)
			setText((value: string) => value.slice(0, -1));
	});

	useEffect(() => {
		let cancelled = false;
		setErrors([]);
		const sentences = Array.from(splitSentences(debouncedText));
		setTranslation((translation) =>
			sentences.map((source: string, i: number) => ({
				loading: true,
				source,
				translation: translation[i]?.translation,
			})),
		);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call
		for (const sentence of enumerate(sentences)) {
			const [i, source] = sentence as [number, string];
			translateSentence(source, {from, to})
				// eslint-disable-next-line  @typescript-eslint/no-loop-func
				.then((response: Response) => {
					if (cancelled) return;
					setTranslation((translation) =>
						translation
							.slice(0, i)
							.concat([{loading: false, source, translation: response}])
							.concat(translation.slice(i + 1)),
					);
				})
				// eslint-disable-next-line  @typescript-eslint/no-loop-func
				.catch((error) => {
					if (cancelled) return;
					setErrors((errors) => errors.concat([error]));
				});
		}

		return () => {
			cancelled = true;
		};
	}, [debouncedText]);

	return (
		<Box flexDirection="column">
			{!debug || debugString === undefined ? null : (
				<Box padding={1} flexDirection="column">
					<Box>
						<Text inverse color="yellow" dimColor>
							DEBUG
						</Text>
					</Box>
					<Box padding={1}>
						<Text color="yellow">
							{JSON.stringify(debugString, undefined, 2)}
						</Text>
					</Box>
				</Box>
			)}

			{savedTexts.map((text, index) => (
				<Block
					key={index}
					from={from}
					to={to}
					text={text}
					translation={savedTranslations[index]}
				/>
			))}
			<Block from={from} to={to} text={text} translation={translation} />

			{errors.length === 0 ? null : (
				<Box padding={1} flexDirection="column">
					<Box>
						<Text inverse color="red" dimColor>
							ERROR
						</Text>
					</Box>
					<Box padding={1}>
						<Text color="red">
							{errors.map((error, index) => (
								<React.Fragment key={index}>
									<Text>{error.message}</Text>
									<Newline />
								</React.Fragment>
							))}
						</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
};

const main = async () => {
	const {from, to, debug} = await parse(process.argv);
	render(<App from={from as string} to={to as string} debug={debug!} />);
};

await main();
