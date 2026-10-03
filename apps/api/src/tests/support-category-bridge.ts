/**
 * The two category lists, re-exported so one test can compare them.
 *
 * `CONDUCT_CATEGORIES` is shared — both the support screen and the query that
 * counts complaints read it. `TICKET_CATEGORIES` is the whole list and lives
 * in the service, which owns it because it builds request validation from it.
 * Importing both from one place keeps the subset assertion honest about where
 * each actually comes from.
 */
export { CONDUCT_CATEGORIES } from '@psirs/shared';
export { TICKET_CATEGORIES } from '../services/support';
