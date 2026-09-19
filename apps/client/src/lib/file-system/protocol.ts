// Wire protocol for the service worker download channel.
//
// These numbers must stay in sync with `apps/client/public/sw.js`.
// That file is plain JS served from `public/` and cannot import this module,
// so any change here needs the same change there.
//
// WRITE and PULL share 0, ERROR and ABORT share 1. Do not renumber.

export const WRITE = 0;
export const PULL = 0;
export const ERROR = 1;
export const ABORT = 1;
export const CLOSE = 2;
export const PING = 3;
