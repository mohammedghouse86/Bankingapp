class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new ApiError(400, 'BAD_REQUEST', message, details);
const unauthorized = (message = 'Authentication required') => new ApiError(401, 'UNAUTHORIZED', message);
const forbidden = (message = 'You do not have permission to perform this action') => new ApiError(403, 'FORBIDDEN', message);
// Object-level authorization failures deliberately return 404 so that callers
// cannot distinguish "exists but not yours" from "does not exist".
const notFound = (resource = 'Resource') => new ApiError(404, 'NOT_FOUND', `${resource} not found`);
const conflict = (message, details) => new ApiError(409, 'CONFLICT', message, details);
const unprocessable = (code, message, details) => new ApiError(422, code, message, details);

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable };
