import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedCookieRequest } from "../domain/request-security.js";

const allowedOrigins = new Set(["https://wescomm.example.edu.ph", "http://localhost:3000"]);

test("safe reads are allowed without CSRF origin checks", () => {
  assert.equal(isTrustedCookieRequest({
    method: "GET",
    hasAuthorizationHeader: false,
    hasSessionCookie: true,
    fetchSite: "cross-site"
  }, allowedOrigins), true);
});

test("cookie-authenticated writes require an approved origin", () => {
  assert.equal(isTrustedCookieRequest({
    method: "POST",
    hasAuthorizationHeader: false,
    hasSessionCookie: true,
    origin: "https://wescomm.example.edu.ph",
    fetchSite: "same-origin"
  }, allowedOrigins), true);

  assert.equal(isTrustedCookieRequest({
    method: "POST",
    hasAuthorizationHeader: false,
    hasSessionCookie: true,
    origin: "https://malicious.example",
    fetchSite: "cross-site"
  }, allowedOrigins), false);

  assert.equal(isTrustedCookieRequest({
    method: "PATCH",
    hasAuthorizationHeader: false,
    hasSessionCookie: true
  }, allowedOrigins), false);
});

test("bearer clients and unauthenticated requests are not treated as cookie CSRF", () => {
  assert.equal(isTrustedCookieRequest({
    method: "DELETE",
    hasAuthorizationHeader: true,
    hasSessionCookie: false
  }, allowedOrigins), true);

  assert.equal(isTrustedCookieRequest({
    method: "POST",
    hasAuthorizationHeader: false,
    hasSessionCookie: false
  }, allowedOrigins), true);
});
