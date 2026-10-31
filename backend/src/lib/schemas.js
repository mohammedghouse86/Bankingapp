// Shared Zod building blocks for request validation.
const { z } = require('zod');

const id = z.coerce.number().int().positive();
const idParams = z.object({ id });

const amount = z.number({ error: 'amount must be a number' })
  .positive('amount must be greater than zero')
  .max(10000000, 'amount exceeds the maximum single transaction size')
  .refine((v) => Math.round(v * 100) === Number((v * 100).toFixed(6)), 'amount may have at most two decimal places');

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const dateOrDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, 'expected YYYY-MM-DD or ISO date-time');

const paging = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  search: z.string().trim().max(100).optional(),
};
const pagingQuery = z.object(paging).strict();

const name = z.string().trim().min(1).max(60).regex(/^[\p{L}][\p{L} .'-]*$/u, 'contains invalid characters');
const phone = z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'invalid phone number');
const email = z.string().trim().toLowerCase().email().max(120);
const text = (max = 500) => z.string().trim().min(1).max(max);
const address = z.object({
  line1: z.string().trim().min(3).max(120),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(40),
  postalCode: z.string().trim().regex(/^[A-Za-z0-9 -]{3,10}$/),
  country: z.string().trim().length(2).default('US'),
}).strict();

const password = z.string().min(1).max(128);

module.exports = { z, id, idParams, amount, date, dateOrDateTime, paging, pagingQuery, name, phone, email, text, address, password };
