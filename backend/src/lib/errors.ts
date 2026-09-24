export type ErrorBody = {
	error: {
		message: string;
		code: string;
	};
};

export function errorBody(message: string, code = "internal_error"): ErrorBody {
	return { error: { message, code } };
}

export function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 429 || status >= 500;
}
