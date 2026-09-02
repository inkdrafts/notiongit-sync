#!/usr/bin/env node
// @bun
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = import.meta.require;

// node_modules/@notionhq/client/build/src/utils.js
var require_utils = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.isObject = exports.pick = exports.assertNever = undefined;
  function assertNever(value) {
    throw new Error(`Unexpected value should never occur: ${value}`);
  }
  exports.assertNever = assertNever;
  function pick(base, keys) {
    const entries = keys.map((key) => [key, base === null || base === undefined ? undefined : base[key]]);
    return Object.fromEntries(entries);
  }
  exports.pick = pick;
  function isObject(o) {
    return typeof o === "object" && o !== null;
  }
  exports.isObject = isObject;
});

// node_modules/@notionhq/client/build/src/logging.js
var require_logging = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.logLevelSeverity = exports.makeConsoleLogger = exports.LogLevel = undefined;
  var utils_1 = require_utils();
  var LogLevel;
  (function(LogLevel2) {
    LogLevel2["DEBUG"] = "debug";
    LogLevel2["INFO"] = "info";
    LogLevel2["WARN"] = "warn";
    LogLevel2["ERROR"] = "error";
  })(LogLevel = exports.LogLevel || (exports.LogLevel = {}));
  function makeConsoleLogger(name) {
    return (level, message, extraInfo) => {
      console[level](`${name} ${level}:`, message, extraInfo);
    };
  }
  exports.makeConsoleLogger = makeConsoleLogger;
  function logLevelSeverity(level) {
    switch (level) {
      case LogLevel.DEBUG:
        return 20;
      case LogLevel.INFO:
        return 40;
      case LogLevel.WARN:
        return 60;
      case LogLevel.ERROR:
        return 80;
      default:
        return (0, utils_1.assertNever)(level);
    }
  }
  exports.logLevelSeverity = logLevelSeverity;
});

// node_modules/@notionhq/client/build/src/errors.js
var require_errors = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.buildRequestError = exports.APIResponseError = exports.UnknownHTTPResponseError = exports.isHTTPResponseError = exports.RequestTimeoutError = exports.isNotionClientError = exports.ClientErrorCode = exports.APIErrorCode = undefined;
  var utils_1 = require_utils();
  var APIErrorCode;
  (function(APIErrorCode2) {
    APIErrorCode2["Unauthorized"] = "unauthorized";
    APIErrorCode2["RestrictedResource"] = "restricted_resource";
    APIErrorCode2["ObjectNotFound"] = "object_not_found";
    APIErrorCode2["RateLimited"] = "rate_limited";
    APIErrorCode2["InvalidJSON"] = "invalid_json";
    APIErrorCode2["InvalidRequestURL"] = "invalid_request_url";
    APIErrorCode2["InvalidRequest"] = "invalid_request";
    APIErrorCode2["ValidationError"] = "validation_error";
    APIErrorCode2["ConflictError"] = "conflict_error";
    APIErrorCode2["InternalServerError"] = "internal_server_error";
    APIErrorCode2["ServiceUnavailable"] = "service_unavailable";
  })(APIErrorCode = exports.APIErrorCode || (exports.APIErrorCode = {}));
  var ClientErrorCode;
  (function(ClientErrorCode2) {
    ClientErrorCode2["RequestTimeout"] = "notionhq_client_request_timeout";
    ClientErrorCode2["ResponseError"] = "notionhq_client_response_error";
  })(ClientErrorCode = exports.ClientErrorCode || (exports.ClientErrorCode = {}));

  class NotionClientErrorBase extends Error {
  }
  function isNotionClientError(error) {
    return (0, utils_1.isObject)(error) && error instanceof NotionClientErrorBase;
  }
  exports.isNotionClientError = isNotionClientError;
  function isNotionClientErrorWithCode(error, codes) {
    return isNotionClientError(error) && error.code in codes;
  }

  class RequestTimeoutError extends NotionClientErrorBase {
    constructor(message = "Request to Notion API has timed out") {
      super(message);
      this.code = ClientErrorCode.RequestTimeout;
      this.name = "RequestTimeoutError";
    }
    static isRequestTimeoutError(error) {
      return isNotionClientErrorWithCode(error, {
        [ClientErrorCode.RequestTimeout]: true
      });
    }
    static rejectAfterTimeout(promise, timeoutMS) {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new RequestTimeoutError);
        }, timeoutMS);
        promise.then(resolve).catch(reject).then(() => clearTimeout(timeoutId));
      });
    }
  }
  exports.RequestTimeoutError = RequestTimeoutError;

  class HTTPResponseError extends NotionClientErrorBase {
    constructor(args) {
      super(args.message);
      this.name = "HTTPResponseError";
      const { code, status, headers, rawBodyText } = args;
      this.code = code;
      this.status = status;
      this.headers = headers;
      this.body = rawBodyText;
    }
  }
  var httpResponseErrorCodes = {
    [ClientErrorCode.ResponseError]: true,
    [APIErrorCode.Unauthorized]: true,
    [APIErrorCode.RestrictedResource]: true,
    [APIErrorCode.ObjectNotFound]: true,
    [APIErrorCode.RateLimited]: true,
    [APIErrorCode.InvalidJSON]: true,
    [APIErrorCode.InvalidRequestURL]: true,
    [APIErrorCode.InvalidRequest]: true,
    [APIErrorCode.ValidationError]: true,
    [APIErrorCode.ConflictError]: true,
    [APIErrorCode.InternalServerError]: true,
    [APIErrorCode.ServiceUnavailable]: true
  };
  function isHTTPResponseError(error) {
    if (!isNotionClientErrorWithCode(error, httpResponseErrorCodes)) {
      return false;
    }
    return true;
  }
  exports.isHTTPResponseError = isHTTPResponseError;

  class UnknownHTTPResponseError extends HTTPResponseError {
    constructor(args) {
      var _a;
      super({
        ...args,
        code: ClientErrorCode.ResponseError,
        message: (_a = args.message) !== null && _a !== undefined ? _a : `Request to Notion API failed with status: ${args.status}`
      });
      this.name = "UnknownHTTPResponseError";
    }
    static isUnknownHTTPResponseError(error) {
      return isNotionClientErrorWithCode(error, {
        [ClientErrorCode.ResponseError]: true
      });
    }
  }
  exports.UnknownHTTPResponseError = UnknownHTTPResponseError;
  var apiErrorCodes = {
    [APIErrorCode.Unauthorized]: true,
    [APIErrorCode.RestrictedResource]: true,
    [APIErrorCode.ObjectNotFound]: true,
    [APIErrorCode.RateLimited]: true,
    [APIErrorCode.InvalidJSON]: true,
    [APIErrorCode.InvalidRequestURL]: true,
    [APIErrorCode.InvalidRequest]: true,
    [APIErrorCode.ValidationError]: true,
    [APIErrorCode.ConflictError]: true,
    [APIErrorCode.InternalServerError]: true,
    [APIErrorCode.ServiceUnavailable]: true
  };

  class APIResponseError extends HTTPResponseError {
    constructor() {
      super(...arguments);
      this.name = "APIResponseError";
    }
    static isAPIResponseError(error) {
      return isNotionClientErrorWithCode(error, apiErrorCodes);
    }
  }
  exports.APIResponseError = APIResponseError;
  function buildRequestError(response, bodyText) {
    const apiErrorResponseBody = parseAPIErrorResponseBody(bodyText);
    if (apiErrorResponseBody !== undefined) {
      return new APIResponseError({
        code: apiErrorResponseBody.code,
        message: apiErrorResponseBody.message,
        headers: response.headers,
        status: response.status,
        rawBodyText: bodyText
      });
    }
    return new UnknownHTTPResponseError({
      message: undefined,
      headers: response.headers,
      status: response.status,
      rawBodyText: bodyText
    });
  }
  exports.buildRequestError = buildRequestError;
  function parseAPIErrorResponseBody(body) {
    if (typeof body !== "string") {
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (parseError) {
      return;
    }
    if (!(0, utils_1.isObject)(parsed) || typeof parsed["message"] !== "string" || !isAPIErrorCode(parsed["code"])) {
      return;
    }
    return {
      ...parsed,
      code: parsed["code"],
      message: parsed["message"]
    };
  }
  function isAPIErrorCode(code) {
    return typeof code === "string" && code in apiErrorCodes;
  }
});

// node_modules/@notionhq/client/build/src/api-endpoints.js
var require_api_endpoints = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.oauthIntrospect = exports.oauthRevoke = exports.oauthToken = exports.listComments = exports.createComment = exports.search = exports.createDatabase = exports.listDatabases = exports.queryDatabase = exports.updateDatabase = exports.getDatabase = exports.appendBlockChildren = exports.listBlockChildren = exports.deleteBlock = exports.updateBlock = exports.getBlock = exports.getPageProperty = exports.updatePage = exports.getPage = exports.createPage = exports.listUsers = exports.getUser = exports.getSelf = undefined;
  exports.getSelf = {
    method: "get",
    pathParams: [],
    queryParams: [],
    bodyParams: [],
    path: () => `users/me`
  };
  exports.getUser = {
    method: "get",
    pathParams: ["user_id"],
    queryParams: [],
    bodyParams: [],
    path: (p) => `users/${p.user_id}`
  };
  exports.listUsers = {
    method: "get",
    pathParams: [],
    queryParams: ["start_cursor", "page_size"],
    bodyParams: [],
    path: () => `users`
  };
  exports.createPage = {
    method: "post",
    pathParams: [],
    queryParams: [],
    bodyParams: ["parent", "properties", "icon", "cover", "content", "children"],
    path: () => `pages`
  };
  exports.getPage = {
    method: "get",
    pathParams: ["page_id"],
    queryParams: ["filter_properties"],
    bodyParams: [],
    path: (p) => `pages/${p.page_id}`
  };
  exports.updatePage = {
    method: "patch",
    pathParams: ["page_id"],
    queryParams: [],
    bodyParams: ["properties", "icon", "cover", "archived", "in_trash"],
    path: (p) => `pages/${p.page_id}`
  };
  exports.getPageProperty = {
    method: "get",
    pathParams: ["page_id", "property_id"],
    queryParams: ["start_cursor", "page_size"],
    bodyParams: [],
    path: (p) => `pages/${p.page_id}/properties/${p.property_id}`
  };
  exports.getBlock = {
    method: "get",
    pathParams: ["block_id"],
    queryParams: [],
    bodyParams: [],
    path: (p) => `blocks/${p.block_id}`
  };
  exports.updateBlock = {
    method: "patch",
    pathParams: ["block_id"],
    queryParams: [],
    bodyParams: [
      "embed",
      "type",
      "archived",
      "in_trash",
      "bookmark",
      "image",
      "video",
      "pdf",
      "file",
      "audio",
      "code",
      "equation",
      "divider",
      "breadcrumb",
      "table_of_contents",
      "link_to_page",
      "table_row",
      "heading_1",
      "heading_2",
      "heading_3",
      "paragraph",
      "bulleted_list_item",
      "numbered_list_item",
      "quote",
      "to_do",
      "toggle",
      "template",
      "callout",
      "synced_block",
      "table"
    ],
    path: (p) => `blocks/${p.block_id}`
  };
  exports.deleteBlock = {
    method: "delete",
    pathParams: ["block_id"],
    queryParams: [],
    bodyParams: [],
    path: (p) => `blocks/${p.block_id}`
  };
  exports.listBlockChildren = {
    method: "get",
    pathParams: ["block_id"],
    queryParams: ["start_cursor", "page_size"],
    bodyParams: [],
    path: (p) => `blocks/${p.block_id}/children`
  };
  exports.appendBlockChildren = {
    method: "patch",
    pathParams: ["block_id"],
    queryParams: [],
    bodyParams: ["children", "after"],
    path: (p) => `blocks/${p.block_id}/children`
  };
  exports.getDatabase = {
    method: "get",
    pathParams: ["database_id"],
    queryParams: [],
    bodyParams: [],
    path: (p) => `databases/${p.database_id}`
  };
  exports.updateDatabase = {
    method: "patch",
    pathParams: ["database_id"],
    queryParams: [],
    bodyParams: [
      "title",
      "description",
      "icon",
      "cover",
      "properties",
      "is_inline",
      "archived",
      "in_trash"
    ],
    path: (p) => `databases/${p.database_id}`
  };
  exports.queryDatabase = {
    method: "post",
    pathParams: ["database_id"],
    queryParams: ["filter_properties"],
    bodyParams: [
      "sorts",
      "filter",
      "start_cursor",
      "page_size",
      "archived",
      "in_trash"
    ],
    path: (p) => `databases/${p.database_id}/query`
  };
  exports.listDatabases = {
    method: "get",
    pathParams: [],
    queryParams: ["start_cursor", "page_size"],
    bodyParams: [],
    path: () => `databases`
  };
  exports.createDatabase = {
    method: "post",
    pathParams: [],
    queryParams: [],
    bodyParams: [
      "parent",
      "properties",
      "icon",
      "cover",
      "title",
      "description",
      "is_inline"
    ],
    path: () => `databases`
  };
  exports.search = {
    method: "post",
    pathParams: [],
    queryParams: [],
    bodyParams: ["sort", "query", "start_cursor", "page_size", "filter"],
    path: () => `search`
  };
  exports.createComment = {
    method: "post",
    pathParams: [],
    queryParams: [],
    bodyParams: ["parent", "rich_text", "discussion_id"],
    path: () => `comments`
  };
  exports.listComments = {
    method: "get",
    pathParams: [],
    queryParams: ["block_id", "start_cursor", "page_size"],
    bodyParams: [],
    path: () => `comments`
  };
  exports.oauthToken = {
    method: "post",
    pathParams: [],
    queryParams: [],
    bodyParams: ["grant_type", "code", "redirect_uri", "external_account"],
    path: () => `oauth/token`
  };
  exports.oauthRevoke = {
    method: "post",
    pathParams: [],
    queryParams: [],
    bodyParams: ["token"],
    path: () => `oauth/revoke`
  };
  exports.oauthIntrospect = {
    method: "post",
    pathParams: [],
    queryParams: [],
    bodyParams: ["token"],
    path: () => `oauth/introspect`
  };
});

// node_modules/@notionhq/client/build/package.json
var require_package = __commonJS(function(exports, module) {
  module.exports = {
    name: "@notionhq/client",
    version: "2.3.0",
    description: "A simple and easy to use client for the Notion API",
    engines: {
      node: ">=12"
    },
    homepage: "https://developers.notion.com/docs/getting-started",
    bugs: {
      url: "https://github.com/makenotion/notion-sdk-js/issues"
    },
    repository: {
      type: "git",
      url: "https://github.com/makenotion/notion-sdk-js/"
    },
    keywords: [
      "notion",
      "notionapi",
      "rest",
      "notion-api"
    ],
    main: "./build/src",
    types: "./build/src/index.d.ts",
    scripts: {
      prepare: "npm run build",
      prepublishOnly: "npm run checkLoggedIn && npm run lint && npm run test",
      build: "tsc",
      prettier: "prettier --write .",
      lint: "prettier --check . && eslint . --ext .ts && cspell '**/*' ",
      test: "jest ./test",
      "check-links": "git ls-files | grep md$ | xargs -n 1 markdown-link-check",
      prebuild: "npm run clean",
      clean: "rm -rf ./build",
      checkLoggedIn: "./scripts/verifyLoggedIn.sh"
    },
    author: "",
    license: "MIT",
    files: [
      "build/package.json",
      "build/src/**"
    ],
    dependencies: {
      "@types/node-fetch": "^2.5.10",
      "node-fetch": "^2.6.1"
    },
    devDependencies: {
      "@types/jest": "^28.1.4",
      "@typescript-eslint/eslint-plugin": "^5.39.0",
      "@typescript-eslint/parser": "^5.39.0",
      cspell: "^5.4.1",
      eslint: "^7.24.0",
      jest: "^28.1.2",
      "markdown-link-check": "^3.8.7",
      prettier: "^2.8.8",
      "ts-jest": "^28.0.5",
      typescript: "^4.8.4"
    }
  };
});

// node_modules/@notionhq/client/build/src/Client.js
var require_Client = __commonJS(function(exports) {
  var __classPrivateFieldSet = exports && exports.__classPrivateFieldSet || function(receiver, state, value, kind, f) {
    if (kind === "m")
      throw new TypeError("Private method is not writable");
    if (kind === "a" && !f)
      throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
      throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
  };
  var __classPrivateFieldGet = exports && exports.__classPrivateFieldGet || function(receiver, state, kind, f) {
    if (kind === "a" && !f)
      throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
      throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
  };
  var _Client_auth;
  var _Client_logLevel;
  var _Client_logger;
  var _Client_prefixUrl;
  var _Client_timeoutMs;
  var _Client_notionVersion;
  var _Client_fetch;
  var _Client_agent;
  var _Client_userAgent;
  Object.defineProperty(exports, "__esModule", { value: true });
  var logging_1 = require_logging();
  var errors_1 = require_errors();
  var utils_1 = require_utils();
  var api_endpoints_1 = require_api_endpoints();
  var node_fetch_1 = __require("node-fetch");
  var package_json_1 = require_package();

  class Client {
    constructor(options) {
      var _a, _b, _c, _d, _e, _f;
      _Client_auth.set(this, undefined);
      _Client_logLevel.set(this, undefined);
      _Client_logger.set(this, undefined);
      _Client_prefixUrl.set(this, undefined);
      _Client_timeoutMs.set(this, undefined);
      _Client_notionVersion.set(this, undefined);
      _Client_fetch.set(this, undefined);
      _Client_agent.set(this, undefined);
      _Client_userAgent.set(this, undefined);
      this.blocks = {
        retrieve: (args) => {
          return this.request({
            path: api_endpoints_1.getBlock.path(args),
            method: api_endpoints_1.getBlock.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.getBlock.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.getBlock.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        update: (args) => {
          return this.request({
            path: api_endpoints_1.updateBlock.path(args),
            method: api_endpoints_1.updateBlock.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.updateBlock.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.updateBlock.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        delete: (args) => {
          return this.request({
            path: api_endpoints_1.deleteBlock.path(args),
            method: api_endpoints_1.deleteBlock.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.deleteBlock.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.deleteBlock.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        children: {
          append: (args) => {
            return this.request({
              path: api_endpoints_1.appendBlockChildren.path(args),
              method: api_endpoints_1.appendBlockChildren.method,
              query: (0, utils_1.pick)(args, api_endpoints_1.appendBlockChildren.queryParams),
              body: (0, utils_1.pick)(args, api_endpoints_1.appendBlockChildren.bodyParams),
              auth: args === null || args === undefined ? undefined : args.auth
            });
          },
          list: (args) => {
            return this.request({
              path: api_endpoints_1.listBlockChildren.path(args),
              method: api_endpoints_1.listBlockChildren.method,
              query: (0, utils_1.pick)(args, api_endpoints_1.listBlockChildren.queryParams),
              body: (0, utils_1.pick)(args, api_endpoints_1.listBlockChildren.bodyParams),
              auth: args === null || args === undefined ? undefined : args.auth
            });
          }
        }
      };
      this.databases = {
        list: (args) => {
          return this.request({
            path: api_endpoints_1.listDatabases.path(),
            method: api_endpoints_1.listDatabases.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.listDatabases.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.listDatabases.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        retrieve: (args) => {
          return this.request({
            path: api_endpoints_1.getDatabase.path(args),
            method: api_endpoints_1.getDatabase.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.getDatabase.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.getDatabase.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        query: (args) => {
          return this.request({
            path: api_endpoints_1.queryDatabase.path(args),
            method: api_endpoints_1.queryDatabase.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.queryDatabase.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.queryDatabase.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        create: (args) => {
          return this.request({
            path: api_endpoints_1.createDatabase.path(),
            method: api_endpoints_1.createDatabase.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.createDatabase.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.createDatabase.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        update: (args) => {
          return this.request({
            path: api_endpoints_1.updateDatabase.path(args),
            method: api_endpoints_1.updateDatabase.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.updateDatabase.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.updateDatabase.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        }
      };
      this.pages = {
        create: (args) => {
          return this.request({
            path: api_endpoints_1.createPage.path(),
            method: api_endpoints_1.createPage.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.createPage.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.createPage.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        retrieve: (args) => {
          return this.request({
            path: api_endpoints_1.getPage.path(args),
            method: api_endpoints_1.getPage.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.getPage.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.getPage.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        update: (args) => {
          return this.request({
            path: api_endpoints_1.updatePage.path(args),
            method: api_endpoints_1.updatePage.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.updatePage.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.updatePage.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        properties: {
          retrieve: (args) => {
            return this.request({
              path: api_endpoints_1.getPageProperty.path(args),
              method: api_endpoints_1.getPageProperty.method,
              query: (0, utils_1.pick)(args, api_endpoints_1.getPageProperty.queryParams),
              body: (0, utils_1.pick)(args, api_endpoints_1.getPageProperty.bodyParams),
              auth: args === null || args === undefined ? undefined : args.auth
            });
          }
        }
      };
      this.users = {
        retrieve: (args) => {
          return this.request({
            path: api_endpoints_1.getUser.path(args),
            method: api_endpoints_1.getUser.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.getUser.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.getUser.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        list: (args) => {
          return this.request({
            path: api_endpoints_1.listUsers.path(),
            method: api_endpoints_1.listUsers.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.listUsers.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.listUsers.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        me: (args) => {
          return this.request({
            path: api_endpoints_1.getSelf.path(),
            method: api_endpoints_1.getSelf.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.getSelf.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.getSelf.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        }
      };
      this.comments = {
        create: (args) => {
          return this.request({
            path: api_endpoints_1.createComment.path(),
            method: api_endpoints_1.createComment.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.createComment.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.createComment.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        },
        list: (args) => {
          return this.request({
            path: api_endpoints_1.listComments.path(),
            method: api_endpoints_1.listComments.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.listComments.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.listComments.bodyParams),
            auth: args === null || args === undefined ? undefined : args.auth
          });
        }
      };
      this.search = (args) => {
        return this.request({
          path: api_endpoints_1.search.path(),
          method: api_endpoints_1.search.method,
          query: (0, utils_1.pick)(args, api_endpoints_1.search.queryParams),
          body: (0, utils_1.pick)(args, api_endpoints_1.search.bodyParams),
          auth: args === null || args === undefined ? undefined : args.auth
        });
      };
      this.oauth = {
        token: (args) => {
          return this.request({
            path: api_endpoints_1.oauthToken.path(),
            method: api_endpoints_1.oauthToken.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.oauthToken.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.oauthToken.bodyParams),
            auth: {
              client_id: args.client_id,
              client_secret: args.client_secret
            }
          });
        },
        introspect: (args) => {
          return this.request({
            path: api_endpoints_1.oauthIntrospect.path(),
            method: api_endpoints_1.oauthIntrospect.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.oauthIntrospect.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.oauthIntrospect.bodyParams),
            auth: {
              client_id: args.client_id,
              client_secret: args.client_secret
            }
          });
        },
        revoke: (args) => {
          return this.request({
            path: api_endpoints_1.oauthRevoke.path(),
            method: api_endpoints_1.oauthRevoke.method,
            query: (0, utils_1.pick)(args, api_endpoints_1.oauthRevoke.queryParams),
            body: (0, utils_1.pick)(args, api_endpoints_1.oauthRevoke.bodyParams),
            auth: {
              client_id: args.client_id,
              client_secret: args.client_secret
            }
          });
        }
      };
      __classPrivateFieldSet(this, _Client_auth, options === null || options === undefined ? undefined : options.auth, "f");
      __classPrivateFieldSet(this, _Client_logLevel, (_a = options === null || options === undefined ? undefined : options.logLevel) !== null && _a !== undefined ? _a : logging_1.LogLevel.WARN, "f");
      __classPrivateFieldSet(this, _Client_logger, (_b = options === null || options === undefined ? undefined : options.logger) !== null && _b !== undefined ? _b : (0, logging_1.makeConsoleLogger)(package_json_1.name), "f");
      __classPrivateFieldSet(this, _Client_prefixUrl, `${(_c = options === null || options === undefined ? undefined : options.baseUrl) !== null && _c !== undefined ? _c : "https://api.notion.com"}/v1/`, "f");
      __classPrivateFieldSet(this, _Client_timeoutMs, (_d = options === null || options === undefined ? undefined : options.timeoutMs) !== null && _d !== undefined ? _d : 60000, "f");
      __classPrivateFieldSet(this, _Client_notionVersion, (_e = options === null || options === undefined ? undefined : options.notionVersion) !== null && _e !== undefined ? _e : Client.defaultNotionVersion, "f");
      __classPrivateFieldSet(this, _Client_fetch, (_f = options === null || options === undefined ? undefined : options.fetch) !== null && _f !== undefined ? _f : node_fetch_1.default, "f");
      __classPrivateFieldSet(this, _Client_agent, options === null || options === undefined ? undefined : options.agent, "f");
      __classPrivateFieldSet(this, _Client_userAgent, `notionhq-client/${package_json_1.version}`, "f");
    }
    async request({ path, method, query, body, auth }) {
      this.log(logging_1.LogLevel.INFO, "request start", { method, path });
      const bodyAsJsonString = !body || Object.entries(body).length === 0 ? undefined : JSON.stringify(body);
      const url = new URL(`${__classPrivateFieldGet(this, _Client_prefixUrl, "f")}${path}`);
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          if (value !== undefined) {
            if (Array.isArray(value)) {
              value.forEach((val) => url.searchParams.append(key, decodeURIComponent(val)));
            } else {
              url.searchParams.append(key, String(value));
            }
          }
        }
      }
      let authorizationHeader;
      if (typeof auth === "object") {
        const unencodedCredential = `${auth.client_id}:${auth.client_secret}`;
        const encodedCredential = Buffer.from(unencodedCredential).toString("base64");
        authorizationHeader = { authorization: `Basic ${encodedCredential}` };
      } else {
        authorizationHeader = this.authAsHeaders(auth);
      }
      const headers = {
        ...authorizationHeader,
        "Notion-Version": __classPrivateFieldGet(this, _Client_notionVersion, "f"),
        "user-agent": __classPrivateFieldGet(this, _Client_userAgent, "f")
      };
      if (bodyAsJsonString !== undefined) {
        headers["content-type"] = "application/json";
      }
      try {
        const response = await errors_1.RequestTimeoutError.rejectAfterTimeout(__classPrivateFieldGet(this, _Client_fetch, "f").call(this, url.toString(), {
          method: method.toUpperCase(),
          headers,
          body: bodyAsJsonString,
          agent: __classPrivateFieldGet(this, _Client_agent, "f")
        }), __classPrivateFieldGet(this, _Client_timeoutMs, "f"));
        const responseText = await response.text();
        if (!response.ok) {
          throw (0, errors_1.buildRequestError)(response, responseText);
        }
        const responseJson = JSON.parse(responseText);
        this.log(logging_1.LogLevel.INFO, "request success", { method, path });
        return responseJson;
      } catch (error) {
        if (!(0, errors_1.isNotionClientError)(error)) {
          throw error;
        }
        this.log(logging_1.LogLevel.WARN, "request fail", {
          code: error.code,
          message: error.message
        });
        if ((0, errors_1.isHTTPResponseError)(error)) {
          this.log(logging_1.LogLevel.DEBUG, "failed response body", {
            body: error.body
          });
        }
        throw error;
      }
    }
    log(level, message, extraInfo) {
      if ((0, logging_1.logLevelSeverity)(level) >= (0, logging_1.logLevelSeverity)(__classPrivateFieldGet(this, _Client_logLevel, "f"))) {
        __classPrivateFieldGet(this, _Client_logger, "f").call(this, level, message, extraInfo);
      }
    }
    authAsHeaders(auth) {
      const headers = {};
      const authHeaderValue = auth !== null && auth !== undefined ? auth : __classPrivateFieldGet(this, _Client_auth, "f");
      if (authHeaderValue !== undefined) {
        headers["authorization"] = `Bearer ${authHeaderValue}`;
      }
      return headers;
    }
  }
  exports.default = Client;
  _Client_auth = new WeakMap, _Client_logLevel = new WeakMap, _Client_logger = new WeakMap, _Client_prefixUrl = new WeakMap, _Client_timeoutMs = new WeakMap, _Client_notionVersion = new WeakMap, _Client_fetch = new WeakMap, _Client_agent = new WeakMap, _Client_userAgent = new WeakMap;
  Client.defaultNotionVersion = "2022-06-28";
});

// node_modules/@notionhq/client/build/src/helpers.js
var require_helpers = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.isMentionRichTextItemResponse = exports.isEquationRichTextItemResponse = exports.isTextRichTextItemResponse = exports.isFullComment = exports.isFullUser = exports.isFullPageOrDatabase = exports.isFullDatabase = exports.isFullPage = exports.isFullBlock = exports.collectPaginatedAPI = exports.iteratePaginatedAPI = undefined;
  async function* iteratePaginatedAPI(listFn, firstPageArgs) {
    let nextCursor = firstPageArgs.start_cursor;
    do {
      const response = await listFn({
        ...firstPageArgs,
        start_cursor: nextCursor
      });
      yield* response.results;
      nextCursor = response.next_cursor;
    } while (nextCursor);
  }
  exports.iteratePaginatedAPI = iteratePaginatedAPI;
  async function collectPaginatedAPI(listFn, firstPageArgs) {
    const results = [];
    for await (const item of iteratePaginatedAPI(listFn, firstPageArgs)) {
      results.push(item);
    }
    return results;
  }
  exports.collectPaginatedAPI = collectPaginatedAPI;
  function isFullBlock(response) {
    return response.object === "block" && "type" in response;
  }
  exports.isFullBlock = isFullBlock;
  function isFullPage(response) {
    return response.object === "page" && "url" in response;
  }
  exports.isFullPage = isFullPage;
  function isFullDatabase(response) {
    return response.object === "database" && "title" in response;
  }
  exports.isFullDatabase = isFullDatabase;
  function isFullPageOrDatabase(response) {
    if (response.object === "database") {
      return isFullDatabase(response);
    } else {
      return isFullPage(response);
    }
  }
  exports.isFullPageOrDatabase = isFullPageOrDatabase;
  function isFullUser(response) {
    return "type" in response;
  }
  exports.isFullUser = isFullUser;
  function isFullComment(response) {
    return "created_by" in response;
  }
  exports.isFullComment = isFullComment;
  function isTextRichTextItemResponse(richText) {
    return richText.type === "text";
  }
  exports.isTextRichTextItemResponse = isTextRichTextItemResponse;
  function isEquationRichTextItemResponse(richText) {
    return richText.type === "equation";
  }
  exports.isEquationRichTextItemResponse = isEquationRichTextItemResponse;
  function isMentionRichTextItemResponse(richText) {
    return richText.type === "mention";
  }
  exports.isMentionRichTextItemResponse = isMentionRichTextItemResponse;
});

// node_modules/@notionhq/client/build/src/index.js
var require_src = __commonJS(function(exports) {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.isFullPageOrDatabase = exports.isFullComment = exports.isFullUser = exports.isFullPage = exports.isFullDatabase = exports.isFullBlock = exports.iteratePaginatedAPI = exports.collectPaginatedAPI = exports.isNotionClientError = exports.RequestTimeoutError = exports.UnknownHTTPResponseError = exports.APIResponseError = exports.ClientErrorCode = exports.APIErrorCode = exports.LogLevel = exports.Client = undefined;
  var Client_1 = require_Client();
  Object.defineProperty(exports, "Client", { enumerable: true, get: function() {
    return Client_1.default;
  } });
  var logging_1 = require_logging();
  Object.defineProperty(exports, "LogLevel", { enumerable: true, get: function() {
    return logging_1.LogLevel;
  } });
  var errors_1 = require_errors();
  Object.defineProperty(exports, "APIErrorCode", { enumerable: true, get: function() {
    return errors_1.APIErrorCode;
  } });
  Object.defineProperty(exports, "ClientErrorCode", { enumerable: true, get: function() {
    return errors_1.ClientErrorCode;
  } });
  Object.defineProperty(exports, "APIResponseError", { enumerable: true, get: function() {
    return errors_1.APIResponseError;
  } });
  Object.defineProperty(exports, "UnknownHTTPResponseError", { enumerable: true, get: function() {
    return errors_1.UnknownHTTPResponseError;
  } });
  Object.defineProperty(exports, "RequestTimeoutError", { enumerable: true, get: function() {
    return errors_1.RequestTimeoutError;
  } });
  Object.defineProperty(exports, "isNotionClientError", { enumerable: true, get: function() {
    return errors_1.isNotionClientError;
  } });
  var helpers_1 = require_helpers();
  Object.defineProperty(exports, "collectPaginatedAPI", { enumerable: true, get: function() {
    return helpers_1.collectPaginatedAPI;
  } });
  Object.defineProperty(exports, "iteratePaginatedAPI", { enumerable: true, get: function() {
    return helpers_1.iteratePaginatedAPI;
  } });
  Object.defineProperty(exports, "isFullBlock", { enumerable: true, get: function() {
    return helpers_1.isFullBlock;
  } });
  Object.defineProperty(exports, "isFullDatabase", { enumerable: true, get: function() {
    return helpers_1.isFullDatabase;
  } });
  Object.defineProperty(exports, "isFullPage", { enumerable: true, get: function() {
    return helpers_1.isFullPage;
  } });
  Object.defineProperty(exports, "isFullUser", { enumerable: true, get: function() {
    return helpers_1.isFullUser;
  } });
  Object.defineProperty(exports, "isFullComment", { enumerable: true, get: function() {
    return helpers_1.isFullComment;
  } });
  Object.defineProperty(exports, "isFullPageOrDatabase", { enumerable: true, get: function() {
    return helpers_1.isFullPageOrDatabase;
  } });
});

// scripts/sync-notion.js
var require_sync_notion = __commonJS(function(exports, module) {
  var { Client } = require_src();
  var fs = __require("fs");
  var path = __require("path");

  class ConfigError extends Error {
  }
  function isTrue(value) {
    return String(value ?? "").trim().toLowerCase() === "true";
  }
  function resolveConfig(env = process.env) {
    const notionToken = env.NOTION_TOKEN;
    if (!notionToken) {
      throw new ConfigError("NOTION_TOKEN environment variable is not set.");
    }
    const pagesDbId = env.NOTION_PAGES_DATABASE_ID || "";
    const postsDbId = env.NOTION_POSTS_DATABASE_ID || env.NOTION_DATABASE_ID || "";
    if (!pagesDbId && !postsDbId) {
      throw new ConfigError("Set NOTION_PAGES_DATABASE_ID and/or NOTION_POSTS_DATABASE_ID.");
    }
    return {
      notionToken,
      pagesDbId,
      postsDbId,
      allowBulkDelete: isTrue(env.ALLOW_BULK_DELETE),
      maxDeleteRatio: Number(env.MAX_DELETE_RATIO) || 0.5,
      siteRoot: env.SITE_ROOT || path.join(import.meta.dir, ".."),
      notionBaseUrl: env.NOTION_BASE_URL || ""
    };
  }
  var notion;
  var PAGES_DB_ID;
  var POSTS_DB_ID;
  var ALLOW_BULK_DELETE;
  var MAX_DELETE_RATIO;
  var ROOT_DIR;
  var POSTS_DIR;
  var PAGES_DIR;
  var DATA_DIR;
  function initRun(config) {
    PAGES_DB_ID = config.pagesDbId;
    POSTS_DB_ID = config.postsDbId;
    ALLOW_BULK_DELETE = config.allowBulkDelete;
    MAX_DELETE_RATIO = config.maxDeleteRatio;
    notion = new Client({
      auth: config.notionToken,
      ...config.notionBaseUrl ? { baseUrl: config.notionBaseUrl } : {}
    });
    ROOT_DIR = path.resolve(config.siteRoot);
    POSTS_DIR = path.join(ROOT_DIR, "_posts");
    PAGES_DIR = path.join(ROOT_DIR, "_pages");
    DATA_DIR = path.join(ROOT_DIR, "_data");
  }
  function richTextToMarkdown(richText = []) {
    return richText.map((item) => {
      let text = item.plain_text ?? "";
      if (!text)
        return "";
      const ann = item.annotations ?? {};
      const href = item.href;
      if (ann.code)
        text = `\`${text}\``;
      if (ann.bold && ann.italic)
        text = `***${text}***`;
      else if (ann.bold)
        text = `**${text}**`;
      else if (ann.italic)
        text = `*${text}*`;
      if (ann.strikethrough)
        text = `~~${text}~~`;
      if (href)
        text = `[${text}](${href})`;
      return text;
    }).join("");
  }
  function blockToMarkdown(block) {
    const type = block.type;
    const data = block[type];
    if (!data)
      return null;
    switch (type) {
      case "paragraph":
        return richTextToMarkdown(data.rich_text);
      case "heading_1":
        return `# ${richTextToMarkdown(data.rich_text)}`;
      case "heading_2":
        return `## ${richTextToMarkdown(data.rich_text)}`;
      case "heading_3":
        return `### ${richTextToMarkdown(data.rich_text)}`;
      case "bulleted_list_item":
        return `- ${richTextToMarkdown(data.rich_text)}`;
      case "numbered_list_item":
        return `1. ${richTextToMarkdown(data.rich_text)}`;
      case "to_do":
        return `- [${data.checked ? "x" : " "}] ${richTextToMarkdown(data.rich_text)}`;
      case "code": {
        const lang = data.language && data.language !== "plain text" ? data.language : "";
        const code = (data.rich_text ?? []).map((r) => r.plain_text).join("");
        const caption = richTextToMarkdown(data.caption ?? []);
        const block_md = `\`\`\`${lang}
${code}
\`\`\``;
        return caption ? `${block_md}
*${caption}*` : block_md;
      }
      case "quote":
        return `> ${richTextToMarkdown(data.rich_text)}`;
      case "callout": {
        const icon = data.icon?.emoji ? `${data.icon.emoji} ` : "";
        return `> ${icon}${richTextToMarkdown(data.rich_text)}`;
      }
      case "divider":
        return "---";
      case "image": {
        const url = data.type === "external" ? data.external?.url ?? "" : data.file?.url ?? "";
        const caption = richTextToMarkdown(data.caption ?? []);
        return `![${caption}](${url})`;
      }
      case "video": {
        const url = data.type === "external" ? data.external?.url ?? "" : data.file?.url ?? "";
        const caption = richTextToMarkdown(data.caption ?? []);
        return caption ? `[\u25B6 ${caption}](${url})` : `[\u25B6 Watch video](${url})`;
      }
      case "bookmark":
      case "link_preview": {
        const url = data.url ?? "";
        return `[${url}](${url})`;
      }
      case "toggle":
        return `<details>
<summary>${richTextToMarkdown(data.rich_text)}</summary>

</details>`;
      case "table_of_contents":
        return "";
      case "child_page":
      case "child_database":
        return null;
      default:
        return null;
    }
  }
  var LIST_TYPES = new Set(["bulleted_list_item", "numbered_list_item", "to_do"]);
  function blocksToMarkdown(blocks) {
    const lines = [];
    for (let i = 0;i < blocks.length; i++) {
      const block = blocks[i];
      const md = blockToMarkdown(block);
      if (md === null)
        continue;
      const prevBlock = i > 0 ? blocks[i - 1] : null;
      const isList = LIST_TYPES.has(block.type);
      const prevIsList = prevBlock ? LIST_TYPES.has(prevBlock.type) : false;
      if (lines.length > 0 && !(isList && prevIsList))
        lines.push("");
      if (md !== "")
        lines.push(md);
    }
    return lines.join(`
`).trim();
  }
  async function fetchAllBlocks(blockId) {
    const blocks = [];
    let cursor;
    do {
      const res = await notion.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100
      });
      blocks.push(...res.results);
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
    return blocks;
  }
  async function fetchPublished(databaseId, statusValue = "Published") {
    const pages = [];
    let cursor;
    do {
      const res = await notion.databases.query({
        database_id: databaseId,
        filter: { property: "Status", select: { equals: statusValue } },
        start_cursor: cursor
      });
      pages.push(...res.results);
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
    return pages;
  }
  function titleToSlug(title) {
    return title.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  }
  function yamlStr(value) {
    return JSON.stringify(String(value ?? ""));
  }
  function applyDeletions(dir, label, notionIdToFile, processedIds) {
    const stale = [...notionIdToFile].filter(([id]) => !processedIds.has(id));
    if (stale.length === 0)
      return 0;
    const tracked = notionIdToFile.size;
    const ratio = stale.length / tracked;
    const suspicious = processedIds.size === 0 || stale.length > 1 && ratio > MAX_DELETE_RATIO;
    if (suspicious && !ALLOW_BULK_DELETE) {
      console.error(`
   ABORT: this sync would delete ${stale.length} of ${tracked} tracked ${label} ` + `(${Math.round(ratio * 100)}%).
` + `   Notion returned ${processedIds.size} published row(s), which usually means the
` + `   database was misread \u2014 a renamed Status option, a revoked integration share,
` + `   or a partial API response \u2014 not that you unpublished them.

` + `   Would have deleted:
` + stale.map(([, f]) => `     - ${f}`).join(`
`) + `

` + `   Nothing was changed. Check the database in Notion. If the deletion is real,
` + `   re-run this workflow with ALLOW_BULK_DELETE=true.`);
      throw new Error(`bulk-delete guard tripped for ${label}`);
    }
    if (suspicious) {
      console.log(`
   ALLOW_BULK_DELETE set \u2014 deleting ${stale.length} of ${tracked} ${label}.`);
    }
    let deleted = 0;
    for (const [, filename] of stale) {
      try {
        fs.unlinkSync(path.join(dir, filename));
        deleted++;
        console.log(`
   removed (unpublished): ${filename}`);
      } catch {
        console.warn(`   Warning: could not remove ${filename}`);
      }
    }
    return deleted;
  }
  function buildNavYaml(items) {
    if (items.length === 0)
      return `[]
`;
    return items.map((item) => `- title: ${yamlStr(item.title)}
  url: ${yamlStr(item.url)}`).join(`
`) + `
`;
  }
  function buildHomeYaml(data) {
    const lines = [];
    lines.push(`name: ${yamlStr(data.name)}`);
    lines.push(`tagline: ${yamlStr(data.tagline)}`);
    lines.push(`profile_picture: ${yamlStr(data.profile_picture)}`);
    if (data.social_links && data.social_links.length > 0) {
      lines.push("social_links:");
      for (const link of data.social_links) {
        lines.push(`  - name: ${yamlStr(link.name)}`);
        lines.push(`    url: ${yamlStr(link.url)}`);
      }
    } else {
      lines.push("social_links: []");
    }
    if (data.bio) {
      lines.push("bio: |");
      for (const line of data.bio.split(`
`)) {
        lines.push(`  ${line}`);
      }
    } else {
      lines.push('bio: ""');
    }
    lines.push(`notion_id: ${yamlStr(data.notion_id)}`);
    return lines.join(`
`) + `
`;
  }
  function syncConfigIdentity(name) {
    if (!name)
      return false;
    const configPath = path.join(ROOT_DIR, "_config.yml");
    let original;
    try {
      original = fs.readFileSync(configPath, "utf8");
    } catch {
      console.warn("   Warning: _config.yml not readable \u2014 site title left unchanged.");
      return false;
    }
    let inAuthor = false;
    let sawTitle = false;
    let sawAuthorName = false;
    const updated = original.split(`
`).map((line) => {
      const isBlank = line.trim() === "";
      const isIndented = /^[ \t]/.test(line);
      if (!isBlank && !isIndented)
        inAuthor = /^author:[ \t]*(#.*)?$/.test(line);
      if (!isIndented && /^title:/.test(line)) {
        sawTitle = true;
        return `title: ${yamlStr(name)}`;
      }
      if (inAuthor && isIndented && /^[ \t]+name:/.test(line)) {
        sawAuthorName = true;
        return `${line.match(/^[ \t]+/)[0]}name: ${yamlStr(name)}`;
      }
      return line;
    }).join(`
`);
    if (!sawTitle)
      console.warn("   Warning: no top-level `title:` in _config.yml \u2014 tab title not updated.");
    if (!sawAuthorName)
      console.warn("   Warning: no `author.name` in _config.yml \u2014 feed author not updated.");
    if (updated === original) {
      console.log("   unchanged: _config.yml");
      return false;
    }
    fs.writeFileSync(configPath, updated, "utf8");
    console.log(`   updated: _config.yml (site title \u2192 ${name})`);
    return true;
  }
  function parseSocialLinks(raw) {
    if (!raw || !raw.trim())
      return [];
    return raw.split(`
`).map((line) => line.trim()).filter(Boolean).map((line) => {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1)
        return null;
      const name = line.slice(0, colonIdx).trim();
      const url = line.slice(colonIdx + 1).trim();
      if (!name || !url)
        return null;
      return { name, url: url.startsWith("//") ? `https:${url}` : url };
    }).filter(Boolean);
  }
  function extractPageMeta(page) {
    const props = page.properties;
    const titleProp = props.Title ?? props.title ?? props.Name;
    const title = titleProp?.title?.[0]?.plain_text ?? titleProp?.rich_text?.[0]?.plain_text ?? "Untitled";
    const slugProp = props.Slug ?? props.slug;
    const slug = slugProp?.rich_text?.[0]?.plain_text?.trim() || titleToSlug(title);
    const typeProp = props.Type ?? props.type;
    const type = typeProp?.select?.name?.toLowerCase() ?? "markdown";
    const navOrderProp = props["Nav Order"] ?? props["Nav order"] ?? props["Order"];
    const navOrder = navOrderProp?.number ?? 99;
    const showInNavProp = props["Show in Nav"] ?? props["Show In Nav"] ?? props["Nav"];
    const showInNav = showInNavProp?.checkbox ?? false;
    const descProp = props.Description ?? props.Excerpt ?? props.Summary;
    const description = descProp?.rich_text?.[0]?.plain_text?.trim() ?? "";
    const nameProp = props["Name"] ?? props["Display Name"] ?? props["Author Name"];
    const displayName = nameProp?.rich_text?.[0]?.plain_text?.trim() || title;
    const picProp = props["Profile Picture"] ?? props["Avatar"] ?? props["Photo"];
    const profile_picture = picProp?.rich_text?.[0]?.plain_text?.trim() ?? "";
    const taglineProp = props.Tagline ?? props["Short Bio"] ?? props.Subtitle;
    const tagline = taglineProp?.rich_text?.[0]?.plain_text?.trim() ?? "";
    const socialProp = props["Social Links"] ?? props["Socials"] ?? props["Links"];
    const socialRaw = socialProp?.rich_text?.map((r) => r.plain_text).join("") ?? "";
    const social_links = parseSocialLinks(socialRaw);
    return { title, displayName, slug, type, navOrder, showInNav, description, profile_picture, tagline, social_links };
  }
  function buildPageFrontMatter(meta, notionId, layout) {
    const lines = ["---"];
    lines.push(`layout: ${layout}`);
    lines.push(`title: ${yamlStr(meta.title)}`);
    lines.push(`slug: ${meta.slug}`);
    if (meta.description)
      lines.push(`description: ${yamlStr(meta.description)}`);
    lines.push(`notion_id: ${yamlStr(notionId)}`);
    lines.push("---");
    return lines.join(`
`);
  }
  function typeToLayout(type) {
    switch (type) {
      case "blog-list":
      case "blog":
        return "blog";
      case "home":
        return "home";
      default:
        return "page";
    }
  }
  async function syncPages() {
    console.log(`
\u2500\u2500 Pages sync \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
    console.log(`   Database: ${PAGES_DB_ID}`);
    fs.mkdirSync(PAGES_DIR, { recursive: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const existingFiles = fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith(".md"));
    const notionIdToFile = new Map;
    for (const file of existingFiles) {
      try {
        const content = fs.readFileSync(path.join(PAGES_DIR, file), "utf8");
        const match = content.match(/^notion_id:\s*"?([a-f0-9-]{36})"?/m);
        if (match)
          notionIdToFile.set(match[1], file);
      } catch {}
    }
    let publishedPages;
    try {
      publishedPages = await fetchPublished(PAGES_DB_ID);
    } catch (err) {
      throw new Error(`Error querying pages database: ${err.message}`);
    }
    console.log(`   Published pages in Notion: ${publishedPages.length}
`);
    const navItems = [];
    let homeData = null;
    const processedIds = new Set;
    const stats = { created: 0, updated: 0, renamed: 0, deleted: 0, unchanged: 0, errors: 0 };
    for (const page of publishedPages) {
      processedIds.add(page.id);
      let meta;
      try {
        meta = extractPageMeta(page);
      } catch (err) {
        console.error(`   [skip] Cannot read metadata for ${page.id}: ${err.message}`);
        stats.errors++;
        continue;
      }
      console.log(`   \u2192 "${meta.title}" (${meta.type}, /${meta.slug})`);
      if (meta.showInNav) {
        navItems.push({
          title: meta.title,
          url: meta.type === "home" ? "/" : `/${meta.slug}`,
          order: meta.navOrder
        });
      }
      if (meta.type === "home") {
        try {
          const blocks = await fetchAllBlocks(page.id);
          const bio = blocksToMarkdown(blocks);
          homeData = {
            name: meta.displayName,
            tagline: meta.tagline,
            profile_picture: meta.profile_picture,
            social_links: meta.social_links,
            bio,
            notion_id: page.id
          };
          console.log("     home data collected");
        } catch (err) {
          console.error(`     [error] ${err.message}`);
          stats.errors++;
        }
        continue;
      }
      try {
        const blocks = await fetchAllBlocks(page.id);
        const body = blocksToMarkdown(blocks);
        const layout = typeToLayout(meta.type);
        const fm = buildPageFrontMatter(meta, page.id, layout);
        const content = `${fm}

${body}
`;
        const filename = `${meta.slug}.md`;
        const filePath = path.join(PAGES_DIR, filename);
        const prevFilename = notionIdToFile.get(page.id);
        const renamed = Boolean(prevFilename && prevFilename !== filename);
        if (renamed) {
          try {
            fs.unlinkSync(path.join(PAGES_DIR, prevFilename));
          } catch {}
          stats.renamed++;
          console.log(`     renamed: ${prevFilename} \u2192 ${filename}`);
        }
        let needsWrite = true;
        if (fs.existsSync(filePath)) {
          needsWrite = fs.readFileSync(filePath, "utf8") !== content;
        }
        if (needsWrite) {
          fs.writeFileSync(filePath, content, "utf8");
          if (!renamed) {
            const isNew = !existingFiles.includes(filename);
            console.log(`     ${isNew ? "created" : "updated"}: _pages/${filename}`);
            isNew ? stats.created++ : stats.updated++;
          } else {
            console.log(`     wrote: _pages/${filename}`);
          }
        } else {
          console.log("     unchanged");
          stats.unchanged++;
        }
      } catch (err) {
        console.error(`     [error] ${err.message}`);
        stats.errors++;
      }
    }
    stats.deleted += applyDeletions(PAGES_DIR, "pages", notionIdToFile, processedIds);
    navItems.sort((a, b) => a.order - b.order);
    const navYaml = buildNavYaml(navItems);
    const navPath = path.join(DATA_DIR, "nav.yml");
    const existingNav = fs.existsSync(navPath) ? fs.readFileSync(navPath, "utf8") : "";
    let navChanged = false;
    if (existingNav !== navYaml) {
      fs.writeFileSync(navPath, navYaml, "utf8");
      navChanged = true;
      console.log(`
   updated: _data/nav.yml`);
    } else {
      console.log(`
   unchanged: _data/nav.yml`);
    }
    let homeChanged = false;
    let configChanged = false;
    if (homeData) {
      const homeYaml = buildHomeYaml(homeData);
      const homePath = path.join(DATA_DIR, "home.yml");
      const existingHome = fs.existsSync(homePath) ? fs.readFileSync(homePath, "utf8") : "";
      if (existingHome !== homeYaml) {
        fs.writeFileSync(homePath, homeYaml, "utf8");
        homeChanged = true;
        console.log("   updated: _data/home.yml");
      } else {
        console.log("   unchanged: _data/home.yml");
      }
      configChanged = syncConfigIdentity(homeData.name);
    }
    console.log(`
   Created: ${stats.created} | Updated: ${stats.updated} | Unchanged: ${stats.unchanged} | Errors: ${stats.errors}`);
    return { stats, navChanged, homeChanged, configChanged };
  }
  function extractPostMeta(page) {
    const props = page.properties;
    const titleProp = props.Title ?? props.title ?? props.Name;
    const title = titleProp?.title?.[0]?.plain_text ?? titleProp?.rich_text?.[0]?.plain_text ?? "Untitled";
    const slugProp = props.Slug ?? props.slug;
    const slug = slugProp?.rich_text?.[0]?.plain_text?.trim() || titleToSlug(title);
    const dateProp = props["Publish Date"] ?? props.Date ?? props.Published;
    const date = dateProp?.date?.start ?? new Date().toISOString().split("T")[0];
    const tags = (props.Tags?.multi_select ?? []).map((t) => t.name);
    const descProp = props.Description ?? props.Excerpt ?? props.Summary;
    const description = descProp?.rich_text?.[0]?.plain_text?.trim() ?? "";
    const coverFiles = props["Cover Image"]?.files ?? [];
    const coverImage = coverFiles[0]?.external?.url ?? coverFiles[0]?.file?.url ?? "";
    const canonicalUrl = props["Canonical URL"]?.url ?? "";
    const featured = props.Featured?.checkbox ?? false;
    return { title, slug, date, tags, description, coverImage, canonicalUrl, featured };
  }
  function buildPostFrontMatter(meta, notionId) {
    const lines = ["---"];
    lines.push(`layout: post`);
    lines.push(`title: ${yamlStr(meta.title)}`);
    lines.push(`date: ${meta.date}`);
    lines.push(`slug: ${meta.slug}`);
    if (meta.tags.length > 0) {
      lines.push(`tags: [${meta.tags.map(yamlStr).join(", ")}]`);
    }
    if (meta.description)
      lines.push(`excerpt: ${yamlStr(meta.description)}`);
    if (meta.coverImage)
      lines.push(`cover_image: ${yamlStr(meta.coverImage)}`);
    if (meta.canonicalUrl)
      lines.push(`canonical_url: ${yamlStr(meta.canonicalUrl)}`);
    if (meta.featured)
      lines.push(`featured: true`);
    lines.push(`notion_id: ${yamlStr(notionId)}`);
    lines.push("---");
    return lines.join(`
`);
  }
  function postFilename(date, slug) {
    return `${date}-${slug}.md`;
  }
  async function syncPosts() {
    console.log(`
\u2500\u2500 Posts sync \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
    console.log(`   Database: ${POSTS_DB_ID}`);
    fs.mkdirSync(POSTS_DIR, { recursive: true });
    const existingFiles = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md"));
    const notionIdToFile = new Map;
    for (const file of existingFiles) {
      try {
        const content = fs.readFileSync(path.join(POSTS_DIR, file), "utf8");
        const match = content.match(/^notion_id:\s*"?([a-f0-9-]{36})"?/m);
        if (match)
          notionIdToFile.set(match[1], file);
      } catch {}
    }
    console.log(`   Existing posts in _posts/: ${existingFiles.length}`);
    let publishedPages;
    try {
      publishedPages = await fetchPublished(POSTS_DB_ID);
    } catch (err) {
      throw new Error(`Error querying posts database: ${err.message}`);
    }
    console.log(`   Published posts in Notion: ${publishedPages.length}
`);
    const processedIds = new Set;
    const stats = { created: 0, updated: 0, renamed: 0, deleted: 0, unchanged: 0, errors: 0 };
    for (const page of publishedPages) {
      processedIds.add(page.id);
      let meta;
      try {
        meta = extractPostMeta(page);
      } catch (err) {
        console.error(`   [skip] Cannot read metadata for ${page.id}: ${err.message}`);
        stats.errors++;
        continue;
      }
      console.log(`   \u2192 "${meta.title}"`);
      try {
        const blocks = await fetchAllBlocks(page.id);
        const body = blocksToMarkdown(blocks);
        const fm = buildPostFrontMatter(meta, page.id);
        const content = `${fm}

${body}
`;
        const filename = postFilename(meta.date, meta.slug);
        const filePath = path.join(POSTS_DIR, filename);
        const prevFilename = notionIdToFile.get(page.id);
        const renamed = Boolean(prevFilename && prevFilename !== filename);
        if (renamed) {
          try {
            fs.unlinkSync(path.join(POSTS_DIR, prevFilename));
          } catch {}
          stats.renamed++;
          console.log(`     renamed: ${prevFilename} \u2192 ${filename}`);
        }
        let needsWrite = true;
        if (fs.existsSync(filePath)) {
          needsWrite = fs.readFileSync(filePath, "utf8") !== content;
        }
        if (needsWrite) {
          fs.writeFileSync(filePath, content, "utf8");
          if (!renamed) {
            const isNew = !existingFiles.includes(filename);
            console.log(`     ${isNew ? "created" : "updated"}: ${filename}`);
            isNew ? stats.created++ : stats.updated++;
          } else {
            console.log(`     wrote: ${filename}`);
          }
        } else {
          console.log("     unchanged");
          stats.unchanged++;
        }
      } catch (err) {
        console.error(`     [error] ${err.message}`);
        stats.errors++;
      }
    }
    stats.deleted += applyDeletions(POSTS_DIR, "posts", notionIdToFile, processedIds);
    console.log(`
   Created: ${stats.created} | Updated: ${stats.updated} | Unchanged: ${stats.unchanged} | Errors: ${stats.errors}`);
    return { stats, navChanged: false, homeChanged: false, configChanged: false };
  }
  function buildActionResult(sections) {
    let changed = false;
    const parts = [];
    for (const { label, stats, navChanged, homeChanged, configChanged } of sections) {
      if (stats.created || stats.updated || stats.renamed || stats.deleted || navChanged || homeChanged || configChanged) {
        changed = true;
      }
      const counts = [
        `${stats.created} created`,
        `${stats.updated} updated`,
        `${stats.renamed} renamed`,
        `${stats.deleted} deleted`,
        `${stats.unchanged} unchanged`
      ];
      if (stats.errors)
        counts.push(`${stats.errors} errors`);
      const section = `${label}: ${counts.join(", ")}`;
      const dataFiles = [
        navChanged ? "nav.yml" : null,
        homeChanged ? "home.yml" : null,
        configChanged ? "_config.yml" : null
      ].filter(Boolean);
      parts.push(dataFiles.length ? `${section} (${dataFiles.join(", ")} updated)` : section);
    }
    if (sections.length === 0)
      parts.push("no sections synced");
    return { changed, summary: parts.join("; ") };
  }
  function writeActionOutputs(result) {
    console.log(`
   changed: ${result.changed}`);
    console.log(`   summary: ${result.summary}`);
    const outPath = process.env.GITHUB_OUTPUT;
    if (!outPath)
      return;
    fs.appendFileSync(outPath, [
      `changed=${result.changed}`,
      "summary<<NOTIONGIT_SYNC_SUMMARY_EOF",
      result.summary,
      "NOTIONGIT_SYNC_SUMMARY_EOF",
      ""
    ].join(`
`));
  }
  async function run(config) {
    initRun(config);
    console.log(`Notion \u2192 Jekyll sync
`);
    const sections = [];
    if (PAGES_DB_ID) {
      sections.push({ label: "pages", ...await syncPages() });
    } else {
      console.log("Skipping pages sync (NOTION_PAGES_DATABASE_ID not set).");
    }
    if (POSTS_DB_ID) {
      sections.push({ label: "posts", ...await syncPosts() });
    } else {
      console.log("Skipping posts sync (NOTION_POSTS_DATABASE_ID / NOTION_DATABASE_ID not set).");
    }
    return sections;
  }
  async function main() {
    let config;
    try {
      config = resolveConfig();
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    let sections;
    try {
      sections = await run(config);
    } catch (err) {
      console.error(`
Fatal: ${err.message}`);
      process.exit(1);
    }
    const totalErrors = sections.reduce((n, s) => n + s.stats.errors, 0);
    console.log(`
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
    writeActionOutputs(buildActionResult(sections));
    if (totalErrors > 0) {
      console.error(`Sync finished with ${totalErrors} error(s). See above for details.`);
      process.exit(1);
    }
    console.log("Sync complete.");
  }
  if (import.meta.main) {
    main().catch((err) => {
      console.error(`
Fatal: ${err.message}`);
      process.exit(1);
    });
  }
  module.exports = {
    ConfigError,
    isTrue,
    resolveConfig,
    buildActionResult,
    writeActionOutputs
  };
});
export default require_sync_notion();
