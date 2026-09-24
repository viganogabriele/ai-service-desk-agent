// The only place allowed to write to the console (see biome.jsonc).
export const log = {
	info: (message: string) => console.log(message),
	warn: (message: string) => console.warn(message),
	error: (message: string, error?: unknown) =>
		error === undefined
			? console.error(message)
			: console.error(message, error),
};
