export type ErrorBody = {
	error: {
		message: string;
		code: string;
	};
};

export function errorBody(message: string, code = "internal_error"): ErrorBody {
	return { error: { message, code } };
}
