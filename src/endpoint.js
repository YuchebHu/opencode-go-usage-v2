// Endpoint validation shared by the extension, preferences and CLI.

import { USAGE_ENDPOINT } from './constants.js';

const HTTP_URL = /^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/i;

export function isValidEndpoint(value) {
    return typeof value === 'string' && HTTP_URL.test(value.trim());
}

export function normalizeEndpoint(value) {
    const text = String(value ?? '').trim();
    return isValidEndpoint(text) ? text : USAGE_ENDPOINT;
}
