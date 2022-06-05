import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import {version} from '../package.json';

const keepLastValue = <T>(value: T | T[]): T | undefined =>
	Array.isArray(value) ? value.pop() : value;

const options = {
	from: {
		alias: 'f',
		coerce: keepLastValue,
		description: 'The language to translate from',
		type: 'string',
		default: 'auto',
	},
	to: {
		alias: 't',
		coerce: keepLastValue,
		description: 'The language to translate to',
		type: 'string',
		default: 'en',
	},
	debug: {
		coerce: keepLastValue,
		description: 'Whether to display debug information',
		type: 'boolean',
	},
} as const;

export const parse = async (input: string[]) => {
	const {argv} = yargs(hideBin(input))
		.version(version)
		.parserConfiguration({
			'boolean-negation': true,
			'camel-case-expansion': false,
			'combine-arrays': false,
			'dot-notation': false,
			'duplicate-arguments-array': true,
			'flatten-duplicate-arrays': true,
			'negation-prefix': 'no-',
			'parse-numbers': true,
			'populate--': true,
			'set-placeholder-key': false,
			'short-option-groups': true,
			'strip-aliased': true,
			'unknown-options-as-args': false,
		})
		.usage('$0 [<options>...]')
		.options(options)
		.example([['$0'], ['$0 --to de']])
		.help();

	const parsed = await argv;
	return parsed;
};
