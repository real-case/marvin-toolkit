import { createRequire } from 'node:module';
import { spawn, execFileSync, execSync, spawnSync } from 'child_process';
import { readFileSync, openSync, closeSync, existsSync, mkdirSync, readdirSync, appendFileSync, writeFileSync, renameSync, realpathSync, linkSync, rmSync, fstatSync, readSync, statSync, mkdtempSync, chmodSync, lstatSync, readlinkSync, rmdirSync, symlinkSync } from 'fs';
import { resolve, posix, basename, join, dirname, sep, isAbsolute, relative } from 'path';
import { fileURLToPath } from 'url';
import { setTimeout } from 'timers/promises';
import { parseArgs, isDeepStrictEqual } from 'util';
import { randomBytes, randomUUID, createHash } from 'crypto';
import { homedir, tmpdir } from 'os';
import { Script, createContext } from 'vm';

const require$1 = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require$1 !== "undefined" ? require$1 : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require$1 !== "undefined" ? require$1 : a)[b]
}) : x)(function(x) {
  if (typeof require$1 !== "undefined") return require$1.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  __defProp(target, "default", { value: mod, enumerable: true }) ,
  mod
));

// ../../../../node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "../../../../node_modules/yaml/dist/nodes/identity.js"(exports) {
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// ../../../../node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "../../../../node_modules/yaml/dist/visit.js"(exports) {
    var identity = require_identity();
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path) {
      const ctrl = callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visit_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = visit_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path) {
      const ctrl = await callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visitAsync_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path) {
      if (typeof visitor === "function")
        return visitor(key, node, path);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path);
      return void 0;
    }
    function replaceNode(key, path, node) {
      const parent = path[path.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// ../../../../node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "../../../../node_modules/yaml/dist/doc/directives.js"(exports) {
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid2 = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid2);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// ../../../../node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "../../../../node_modules/yaml/dist/doc/anchors.js"(exports) {
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// ../../../../node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "../../../../node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// ../../../../node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "../../../../node_modules/yaml/dist/nodes/toJS.js"(exports) {
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// ../../../../node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "../../../../node_modules/yaml/dist/nodes/Node.js"(exports) {
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// ../../../../node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "../../../../node_modules/yaml/dist/nodes/Alias.js"(exports) {
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const { anchors: anchors2, doc, maxAliasCount } = ctx;
        const source = this.resolve(doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        let data = anchors2.get(source);
        if (!data) {
          toJS.toJS(source, null, ctx);
          data = anchors2.get(source);
        }
        if (data?.res === void 0) {
          const msg = "This should not happen: Alias anchor was not resolved?";
          throw new ReferenceError(msg);
        }
        if (maxAliasCount >= 0) {
          data.count += 1;
          if (data.aliasCount === 0)
            data.aliasCount = getAliasCount(doc, source, anchors2);
          if (data.count * data.aliasCount > maxAliasCount) {
            const msg = "Excessive alias count indicates a resource exhaustion attack";
            throw new ReferenceError(msg);
          }
        }
        return data.res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// ../../../../node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "../../../../node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// ../../../../node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "../../../../node_modules/yaml/dist/doc/createNode.js"(exports) {
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// ../../../../node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "../../../../node_modules/yaml/dist/nodes/Collection.js"(exports) {
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path, value) {
      let v = value;
      for (let i = path.length - 1; i >= 0; --i) {
        const k = path[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path, value) {
        if (isEmptyPath(path))
          this.add(value);
        else {
          const [key, ...rest] = path;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        const [key, ...rest] = path;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        const [key, ...rest] = path;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// ../../../../node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "../../../../node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// ../../../../node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "../../../../node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text2, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text2;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text2.length <= endStep)
        return text2;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text2, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text2[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text2[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text2, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text2[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text2[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text2;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text2;
      if (onFold)
        onFold();
      let res = text2.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold2 = folds[i2];
        const end2 = folds[i2 + 1] || text2.length;
        if (fold2 === 0)
          res = `
${indent}${text2.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold2])
            res += `${text2[fold2]}\\`;
          res += `
${indent}${text2.slice(fold2 + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text2, i, indent) {
      let end = i;
      let start2 = i + 1;
      let ch = text2[start2];
      while (ch === " " || ch === "	") {
        if (i < start2 + indent) {
          ch = text2[++i];
        } else {
          do {
            ch = text2[++i];
          } while (ch && ch !== "\n");
          end = i;
          start2 = i + 1;
          ch = text2[start2];
        }
      }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// ../../../../node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "../../../../node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start2 = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start2 > limit)
            return true;
          start2 = i + 1;
          if (strLen - start2 <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start2 = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str += json.slice(start2, i) + "\\ ";
          i += 1;
          start2 = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start2, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i, 6);
                }
                i += 5;
                start2 = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json.slice(start2, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json[i + 2] === " ")
                  str += "\\";
                i += 1;
                start2 = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start2 ? str + json.slice(start2) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start2 = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start2) {
        value = value.substring(start2.length);
        start2 = start2.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start2}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start2}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// ../../../../node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "../../../../node_modules/yaml/dist/stringify/stringify.js"(exports) {
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify3(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify3;
  }
});

// ../../../../node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "../../../../node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify3 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify3.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify3.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// ../../../../node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "../../../../node_modules/yaml/dist/log.js"(exports) {
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// ../../../../node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "../../../../node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge2 = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge2.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge2.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge2.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge2;
  }
});

// ../../../../node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "../../../../node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    var log = require_log();
    var merge2 = require_merge();
    var stringify3 = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge2.isMergeKey(ctx, key))
        merge2.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify3.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// ../../../../node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "../../../../node_modules/yaml/dist/nodes/Pair.js"(exports) {
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// ../../../../node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "../../../../node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    var identity = require_identity();
    var stringify3 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify4 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify4(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify3.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify3.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start: start2, end } = flowChars;
      if (lines.length === 0) {
        return start2 + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start2;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start2}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// ../../../../node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "../../../../node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// ../../../../node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "../../../../node_modules/yaml/dist/schema/common/map.js"(exports) {
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// ../../../../node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "../../../../node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// ../../../../node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "../../../../node_modules/yaml/dist/schema/common/seq.js"(exports) {
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// ../../../../node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "../../../../node_modules/yaml/dist/schema/common/string.js"(exports) {
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string;
  }
});

// ../../../../node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "../../../../node_modules/yaml/dist/schema/common/null.js"(exports) {
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// ../../../../node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "../../../../node_modules/yaml/dist/schema/core/bool.js"(exports) {
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// ../../../../node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "../../../../node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// ../../../../node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "../../../../node_modules/yaml/dist/schema/core/float.js"(exports) {
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// ../../../../node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "../../../../node_modules/yaml/dist/schema/core/int.js"(exports) {
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// ../../../../node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "../../../../node_modules/yaml/dist/schema/core/schema.js"(exports) {
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// ../../../../node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "../../../../node_modules/yaml/dist/schema/json/schema.js"(exports) {
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// ../../../../node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "../../../../node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    var node_buffer = __require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// ../../../../node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "../../../../node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// ../../../../node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "../../../../node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// ../../../../node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "../../../../node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// ../../../../node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "../../../../node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// ../../../../node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "../../../../node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// ../../../../node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "../../../../node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// ../../../../node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "../../../../node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp;
  }
});

// ../../../../node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "../../../../node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge2 = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge2.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports.schema = schema;
  }
});

// ../../../../node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "../../../../node_modules/yaml/dist/schema/tags.js"(exports) {
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge2 = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge2.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge2.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge2.merge) ? schemaTags.concat(merge2.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge2.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// ../../../../node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "../../../../node_modules/yaml/dist/schema/Schema.js"(exports) {
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge: merge2, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge2);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports.Schema = Schema;
  }
});

// ../../../../node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "../../../../node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    var identity = require_identity();
    var stringify3 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify3.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify3.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify3.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// ../../../../node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "../../../../node_modules/yaml/dist/doc/Document.js"(exports) {
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        if (Collection.isEmptyPath(path)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        if (Collection.isEmptyPath(path))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path) {
        if (Collection.isEmptyPath(path))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        if (Collection.isEmptyPath(path)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document;
  }
});

// ../../../../node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "../../../../node_modules/yaml/dist/errors.js"(exports) {
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// ../../../../node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "../../../../node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start2 = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start2 ?? (start2 = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start2 ?? (start2 = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start2 ?? end
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// ../../../../node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "../../../../node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// ../../../../node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "../../../../node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// ../../../../node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "../../../../node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// ../../../../node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "../../../../node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start: start2, key, sep: sep5, value } = collItem;
        const keyProps = resolveProps.resolveProps(start2, {
          indicator: "explicit-key-ind",
          next: key ?? sep5?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep5) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start2[start2.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start2, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep5 ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep5, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// ../../../../node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "../../../../node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start: start2, value } of bs.items) {
        const props = resolveProps.resolveProps(start2, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start2, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// ../../../../node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "../../../../node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep5 = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep5 + cb;
              sep5 = "";
              break;
            }
            case "newline":
              if (comment)
                sep5 += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// ../../../../node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "../../../../node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start: start2, key, sep: sep5, value } = collItem;
        const props = resolveProps.resolveProps(start2, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep5?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep5 && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start2) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep5 && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep5, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start2, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep5 ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep5)
                for (const st of sep5) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep5, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// ../../../../node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "../../../../node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports.composeCollection = composeCollection;
  }
});

// ../../../../node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "../../../../node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start2 = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start2, start2, start2] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start2 + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start2, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep5 = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep5 + indent.slice(trimIndent) + content;
          sep5 = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep5 === " ")
            sep5 = "\n";
          else if (!prevMoreIndented && sep5 === "\n")
            sep5 = "\n\n";
          value += sep5 + indent.slice(trimIndent) + content;
          sep5 = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep5 === "\n")
            value += "\n";
          else
            sep5 = "\n";
        } else {
          value += sep5 + content;
          sep5 = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start2 + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start2, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// ../../../../node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "../../../../node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return foldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return foldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function foldLines(source) {
      let first, line;
      try {
        first = new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
        line = new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
      } catch {
        first = /(.*?)[ \t]*\r?\n/sy;
        line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
      }
      let match = first.exec(source);
      if (!match)
        return source;
      let res = match[1];
      let sep5 = " ";
      let pos = first.lastIndex;
      line.lastIndex = pos;
      while (match = line.exec(source)) {
        if (match[1] === "") {
          if (sep5 === "\n")
            res += sep5;
          else
            sep5 = "\n";
        } else {
          res += sep5 + match[1];
          sep5 = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep5 + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold: fold2, offset } = foldNewline(source, i);
          res += fold2;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold2 = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold2 += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold2)
        fold2 = " ";
      return { fold: fold2, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// ../../../../node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "../../../../node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// ../../../../node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "../../../../node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// ../../../../node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "../../../../node_modules/yaml/dist/compose/compose-node.js"(exports) {
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// ../../../../node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "../../../../node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start: start2, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start2, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start2, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// ../../../../node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "../../../../node_modules/yaml/dist/compose/composer.js"(exports) {
    var node_process = __require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// ../../../../node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "../../../../node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// ../../../../node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "../../../../node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    var stringify3 = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start: start2, key, sep: sep5, value }) {
      let res = "";
      for (const st of start2)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep5)
        for (const st of sep5)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports.stringify = stringify3;
  }
});

// ../../../../node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "../../../../node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path) => {
      let item = cst;
      for (const [field, index] of path) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path) => {
      const parent = visit.itemAtPath(cst, path.slice(0, -1));
      const field = path[path.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path, item, visitor) {
      let ctrl = visitor(item, path);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
    }
    exports.visit = visit;
  }
});

// ../../../../node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "../../../../node_modules/yaml/dist/parse/cst.js"(exports) {
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// ../../../../node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "../../../../node_modules/yaml/dist/parse/lexer.js"(exports) {
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// ../../../../node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "../../../../node_modules/yaml/dist/parse/line-counter.js"(exports) {
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start2 = this.lineStarts[low - 1];
          return { line: low, col: offset - start2 + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter;
  }
});

// ../../../../node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "../../../../node_modules/yaml/dist/parse/parser.js"(exports) {
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list2, type) {
      for (let i = 0; i < list2.length; ++i)
        if (list2[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list2) {
      for (let i = 0; i < list2.length; ++i) {
        switch (list2[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start2 = getFirstKeyStartProps(prev);
          let sep5;
          if (scalar.end) {
            sep5 = scalar.end;
            sep5.push(this.sourceToken);
            delete scalar.end;
          } else
            sep5 = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start: start2, key: scalar, sep: sep5 }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start2 = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start2 = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start2.push(this.sourceToken);
                map.items.push({ start: start2 });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start2.push(this.sourceToken);
                map.items.push({ start: start2, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start3 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start3, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start3 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep5 = it.sep;
                  sep5.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start3, key, sep: sep5 }]
                  });
                } else if (start2.length > 0) {
                  it.sep = it.sep.concat(start2, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start: start2, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start: start2, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start: start2 });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start2 = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep5 = fc.end.splice(1, fc.end.length);
            sep5.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start: start2, key: fc, sep: sep5 }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start2 = getFirstKeyStartProps(prev);
            start2.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: start2, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start2 = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: start2, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start2, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start2.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports.Parser = Parser;
  }
});

// ../../../../node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "../../../../node_modules/yaml/dist/public-api.js"(exports) {
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse4(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify3(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse4;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument;
    exports.stringify = stringify3;
  }
});

// ../../../../node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "../../../../node_modules/yaml/dist/index.js"(exports) {
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity.isAlias;
    exports.isCollection = identity.isCollection;
    exports.isDocument = identity.isDocument;
    exports.isMap = identity.isMap;
    exports.isNode = identity.isNode;
    exports.isPair = identity.isPair;
    exports.isScalar = identity.isScalar;
    exports.isSeq = identity.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit.visit;
    exports.visitAsync = visit.visitAsync;
  }
});

// src/pipeline/assess.ts
var import_yaml2 = __toESM(require_dist());

// ../../../../node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../../../node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../../../node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../../../node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../../../node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../../../node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status2, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status2.dirty();
      arrayValue.push(s.value);
    }
    return { status: status2.value, value: arrayValue };
  }
  static async mergeObjectAsync(status2, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status2, syncPairs);
  }
  static mergeObjectSync(status2, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status2.dirty();
      if (value.status === "dirty")
        status2.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status2.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../../../node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../../../node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status2 = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status2.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status2.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status2.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step2) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step2.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step2.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status2 = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status2.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status2.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status2 = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status2.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status2.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status2.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status2 = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status2.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status2.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status2.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status: status2 } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status2.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status2.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status2.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status2, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status2, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status: status2, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status2.dirty();
        }
      } else if (unknownKeys === "strip") ; else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status2, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status2, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status: status2, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status2.dirty();
      }
      return { status: status2.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status: status2, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status2.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status2, results);
      });
    } else {
      return ParseStatus.mergeArray(status2, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status: status2, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status2, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status2, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status: status2, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status2.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status2.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status2.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status2.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status: status2, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status2.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status2.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status2.dirty();
        parsedSet.add(element.value);
      }
      return { status: status2.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status: status2, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status2.abort();
        } else {
          status2.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status2.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status2.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status2.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status2.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status2.dirty();
        executeRefinement(inner.value);
        return { status: status2.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status2.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status2.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status2.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status2.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status: status2, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status2.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status2.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// src/storage/frontmatter.ts
var import_yaml = __toESM(require_dist());
function parseFrontmatter(text2) {
  if (!text2.startsWith("---\n")) {
    return { frontmatter: {}, body: text2 };
  }
  const endIdx = text2.indexOf("\n---", 4);
  if (endIdx === -1) {
    return { frontmatter: {}, body: text2 };
  }
  const raw = text2.slice(4, endIdx);
  const after = text2.slice(endIdx + 4);
  const body = after.startsWith("\n") ? after.slice(1) : after;
  let doc;
  try {
    doc = (0, import_yaml.parse)(raw, { schema: "failsafe" });
  } catch {
    return { frontmatter: {}, body };
  }
  const frontmatter = {};
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    for (const [key, value] of Object.entries(doc)) {
      if (value == null) continue;
      frontmatter[key] = typeof value === "string" ? value : String(value);
    }
  }
  return { frontmatter, body };
}
function stringifyFrontmatter(frontmatter, body) {
  const clean = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value !== void 0) clean[key] = value;
  }
  const fm = Object.keys(clean).length ? (0, import_yaml.stringify)(clean, { schema: "failsafe" }).trimEnd() : "";
  const lines = ["---"];
  if (fm) lines.push(fm);
  lines.push("---");
  if (body && !body.startsWith("\n")) lines.push("");
  lines.push(body);
  return lines.join("\n");
}
var ID_FILE = /^F\d+$/i;
var ID_AC = /^AC\d+$/i;
var RefList = external_exports.union([external_exports.array(external_exports.union([external_exports.string(), external_exports.number()])), external_exports.string()]);
var FileRow = external_exports.object({
  id: external_exports.string().regex(ID_FILE, "file id must look like F1, F2, \u2026"),
  path: external_exports.string().min(1),
  action: external_exports.enum(["new", "edit", "delete"]),
  intent: external_exports.string().optional(),
  satisfies: RefList.optional(),
  anchor: external_exports.string().optional()
});
var Oracle = external_exports.object({
  kind: external_exports.enum(["test", "command", "prose-review"]),
  ref: external_exports.string().optional(),
  run: external_exports.string().min(1).optional()
});
var Criterion = external_exports.object({
  id: external_exports.string().regex(ID_AC, "criterion id must look like AC1, AC2, \u2026"),
  statement: external_exports.string().min(1),
  implemented_by: RefList,
  oracle: Oracle,
  failure: external_exports.string().optional(),
  regression: external_exports.boolean().optional()
});
var ContractObj = external_exports.object({
  kind: external_exports.enum(["function", "route", "schema", "cli", "event", "none"]),
  signature: external_exports.string().optional()
});
var SpecContract = external_exports.object({
  files: external_exports.array(FileRow).min(1),
  build_order: external_exports.array(external_exports.union([external_exports.string(), external_exports.number()])).optional(),
  contract: ContractObj.optional(),
  criteria: external_exports.array(Criterion).min(1),
  depends_on: external_exports.array(external_exports.string()).optional()
});
external_exports.object({
  spec_location: external_exports.string().optional(),
  decision_record: external_exports.object({ style: external_exports.string().optional(), path: external_exports.string().optional() }).optional(),
  merge_obligations: external_exports.array(external_exports.string()).optional(),
  gates: external_exports.record(external_exports.string()).optional()
}).passthrough();
function extractContractBlock(body) {
  const m = /```[^\n`]*spec-contract[^\n`]*\n([\s\S]*?)\n```/.exec(body);
  return m ? m[1] : null;
}
function contractHash(blockText) {
  return createHash("sha256").update(blockText.trim()).digest("hex").slice(0, 16);
}
var READ_ONLY_ROLES = /* @__PURE__ */ new Set(["verifier", "retro"]);
var WRITING_ROLES = /* @__PURE__ */ new Set([
  "planner",
  "test-author",
  "executor"
]);
var READ_ONLY_DISALLOWED_TOOLS = [
  "Edit",
  "Write",
  "NotebookEdit",
  "MultiEdit",
  "Bash(git push:*)"
];
var READ_BASE_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "SendMessage",
  "ListAgents",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git status:*)",
  "Bash(git ls-files:*)",
  "Bash(git merge-base:*)",
  "Bash(git rev-parse:*)",
  "Bash(gh pr view:*)",
  "Bash(gh pr diff:*)"
];
function validatePrefix(prefix) {
  if (prefix !== prefix.trim()) {
    throw new Error(`invalid allowlist prefix: ${prefix}`);
  }
  if (prefix.length === 0) {
    throw new Error(`invalid allowlist prefix: ${prefix}`);
  }
  if (/[(),[*\n]/.test(prefix)) {
    throw new Error(`invalid allowlist prefix: ${prefix}`);
  }
}
function readOnlyAllowedTools(probePrefixes) {
  probePrefixes.forEach((p) => validatePrefix(p));
  return [...READ_BASE_TOOLS, ...probePrefixes.map((p) => `Bash(${p}:*)`)];
}
var WRITING_BASE_TOOLS = [
  "mcp__plugin_marvin_marvin",
  "SendMessage",
  "ListAgents"
];
function writingAllowedTools(commandPrefixes) {
  commandPrefixes.forEach((p) => validatePrefix(p));
  return [...WRITING_BASE_TOOLS, ...commandPrefixes.map((p) => `Bash(${p}:*)`)];
}
var MODEL_ALIAS = /^(opus|sonnet|haiku)$/;
var MODEL_FULL_ID = /^claude-(opus|sonnet|haiku)-[0-9a-z.-]+$/;
function modelFamily(model) {
  if (/fable/i.test(model)) throw new Error(`Fable is not allowed (user rule): ${model}`);
  const family = MODEL_ALIAS.exec(model)?.[1] ?? MODEL_FULL_ID.exec(model)?.[1];
  if (!family) throw new Error(`model not allowed: ${model}`);
  return family;
}
var MARVIN_MCP_SERVER = "plugin_marvin_marvin";
function marvinMcpConfig(pluginDir, projectDir) {
  return JSON.stringify({
    mcpServers: {
      [MARVIN_MCP_SERVER]: {
        command: "node",
        args: [`${pluginDir}/mcp/server/dist/server.js`],
        env: {
          MARVIN_TASKS_DIR: `${projectDir}/.marvin/track`,
          MARVIN_TASKS_CONFIG: `${projectDir}/.marvin/config.json`
        }
      }
    }
  });
}
function pluginReadRule(pluginDir) {
  if (/[()\n]/.test(pluginDir))
    throw new Error(`pluginDir cannot stand in a permission rule: ${pluginDir}`);
  return `Read(/${pluginDir}/**)`;
}
function buildChildCommand(s) {
  if (!READ_ONLY_ROLES.has(s.role) && !WRITING_ROLES.has(s.role)) {
    throw new Error(`unknown role: ${s.role}`);
  }
  if (!s.allowedTools?.length) throw new Error(`${s.role} needs an explicit allowedTools list`);
  if (READ_ONLY_ROLES.has(s.role)) {
    for (const entry of s.allowedTools) {
      if (entry.startsWith("mcp__") || entry === "Edit" || entry === "Write" || entry === "MultiEdit" || entry === "NotebookEdit") {
        throw new Error(`read-only role ${s.role} cannot be granted ${entry}`);
      }
    }
  }
  if (typeof s.pluginDir !== "string" || !isAbsolute(s.pluginDir)) {
    throw new Error(`${s.role} needs an absolute pluginDir (marvin's plugin root)`);
  }
  modelFamily(s.assignment.model);
  const argv = [
    "claude",
    "-p",
    s.prompt,
    "-n",
    s.name,
    "--model",
    s.assignment.model,
    "--effort",
    s.assignment.effort,
    "--permission-prompts",
    "none",
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    // Read-only roles get no MCP server: none of their allowlists names one (spike S2).
    ...WRITING_ROLES.has(s.role) ? ["--mcp-config", marvinMcpConfig(s.pluginDir, s.cwd)] : [],
    "--plugin-dir",
    s.pluginDir,
    "--output-format",
    "stream-json",
    "--verbose",
    "--settings",
    s.settingsPath,
    "--append-system-prompt-file",
    s.systemPromptPath,
    "--json-schema",
    s.schema
  ];
  if (READ_ONLY_ROLES.has(s.role)) {
    argv.push(
      "--permission-mode",
      "dontAsk",
      "--allowedTools",
      ...s.allowedTools,
      "--disallowedTools",
      ...READ_ONLY_DISALLOWED_TOOLS
    );
  } else {
    argv.push(
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      ...s.allowedTools,
      pluginReadRule(s.pluginDir)
    );
  }
  if (s.resumeSessionId) argv.push("--resume", s.resumeSessionId);
  const env = {
    MARVIN_PIPELINE: "1",
    MARVIN_PIPELINE_RUN: s.runDir,
    MARVIN_PIPELINE_ROLE: s.role,
    MARVIN_PIPELINE_CHILD: s.name,
    MARVIN_PIPELINE_ORCH: s.orchestratorName,
    MARVIN_PIPELINE_BASE: s.base,
    MARVIN_PIPELINE_BRANCH: s.branch ?? "",
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    BASH_DEFAULT_TIMEOUT_MS: "600000",
    BASH_MAX_TIMEOUT_MS: "1800000",
    HUSKY: "0"
  };
  if (s.role === "verifier") env.CI = "true";
  if (s.testPathPattern) env.MARVIN_PIPELINE_TEST_PATTERN = s.testPathPattern;
  return { argv, env, cwd: s.cwd };
}
var STAGES = [
  "intake",
  "planning",
  "awaiting_answer",
  "awaiting_approval",
  "test_authoring",
  "executing",
  "gating",
  "verifying",
  "ci_wait",
  "retro",
  "finalizing",
  "ready",
  "done",
  "halted"
];
var Stage = external_exports.enum(STAGES);
var TIERS = ["light", "standard", "heavy"];
var EFFORTS = ["low", "medium", "high", "xhigh", "max"];
var Assignment = external_exports.object({ model: external_exports.string().min(1), effort: external_exports.enum(EFFORTS) });
var ROLES = ["planner", "test-author", "executor", "verifier", "retro"];
var Json = external_exports.record(external_exports.string(), external_exports.unknown());
var Child = external_exports.object({
  name: external_exports.string(),
  role: external_exports.enum(ROLES),
  iteration: external_exports.number().int().min(0),
  sessionId: external_exports.string().nullable(),
  pid: external_exports.number().int().nullable(),
  assignment: Assignment,
  startedAt: external_exports.string(),
  endedAt: external_exports.string().nullable(),
  status: external_exports.enum([
    "running",
    "needs_input",
    "spec_ready",
    "done",
    "failed",
    "crashed",
    "stalled",
    "limited"
  ]),
  costUsd: external_exports.number().nullable(),
  cacheReadTokens: external_exports.number().nullable()
});
var Run = external_exports.object({
  version: external_exports.literal(2),
  id: external_exports.string(),
  repoRoot: external_exports.string(),
  base: external_exports.string(),
  lang: external_exports.string(),
  orchestratorName: external_exports.string(),
  task: external_exports.object({ original: external_exports.string(), english: external_exports.string() }),
  stageA: external_exports.enum(TIERS),
  stage: Stage,
  haltReason: external_exports.string().nullable(),
  worktree: external_exports.string().nullable(),
  branch: external_exports.string().nullable(),
  specPath: external_exports.string().nullable(),
  tier: external_exports.enum(TIERS).nullable(),
  tierReasons: external_exports.array(external_exports.string()),
  prUrl: external_exports.string().nullable(),
  iteration: external_exports.number().int().min(0),
  rung: external_exports.number().int().min(0),
  rejections: external_exports.array(
    external_exports.object({
      iteration: external_exports.number().int(),
      source: external_exports.enum(["gate", "verifier", "ci"]),
      fingerprints: external_exports.array(external_exports.string())
    })
  ),
  retries: external_exports.record(external_exports.string(), external_exports.number().int()),
  questionsAnswered: external_exports.number().int().min(0),
  testAuthorAttempts: external_exports.number().int().min(0),
  /** Rounds in which the executor asked a question or raised a dispute. Absent from older run files. */
  executorQuestionRounds: external_exports.number().int().min(0).default(0),
  sealed: external_exports.array(
    external_exports.object({ path: external_exports.string(), sha256: external_exports.string(), criteria: external_exports.array(external_exports.string()) })
  ),
  assumptions: external_exports.array(external_exports.string()),
  previousFindings: external_exports.array(Json),
  minorFindings: external_exports.array(Json),
  claims: external_exports.array(external_exports.string()),
  gateReport: Json.nullable(),
  awaitingRole: external_exports.enum(["planner", "executor"]).nullable(),
  pendingJudgment: external_exports.object({ id: external_exports.string(), kind: external_exports.string() }).nullable(),
  pendingWork: external_exports.object({ work: external_exports.string(), data: Json.optional() }).nullable(),
  haltRole: external_exports.enum(ROLES).nullable(),
  finalized: external_exports.boolean(),
  /** When the current wait for CI began; null outside a CI wait. Absent from runs written before it existed. */
  ciSince: external_exports.string().nullable().default(null),
  lastSpawn: external_exports.record(external_exports.string(), Json),
  children: external_exports.array(Child),
  createdAt: external_exports.string(),
  updatedAt: external_exports.string()
});
var NEXT = {
  intake: ["planning"],
  planning: ["awaiting_answer", "awaiting_approval"],
  awaiting_answer: ["planning", "test_authoring", "executing"],
  awaiting_approval: ["planning", "test_authoring", "executing"],
  test_authoring: ["awaiting_answer", "executing"],
  executing: ["awaiting_answer", "gating"],
  gating: ["executing", "verifying"],
  verifying: ["executing", "test_authoring", "ci_wait"],
  ci_wait: ["executing", "retro"],
  retro: ["finalizing"],
  finalizing: ["ready", "done"],
  ready: ["done"],
  done: [],
  halted: ["retro"]
};
function stateRoot(env = process.env) {
  return env.MARVIN_PIPELINE_HOME ?? join(homedir(), ".local", "state", "marvin-pipeline");
}
function runDirFor(repoRoot, id, env = process.env) {
  return join(stateRoot(env), basename(repoRoot), id);
}
function newRunId(now, rand = Math.random) {
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
  return `r${stamp}-${Math.floor(rand() * 65535).toString(16).padStart(4, "0")}`;
}
function initRun(o) {
  const ts = o.now.toISOString();
  return Run.parse({
    version: 2,
    id: o.id,
    repoRoot: o.repoRoot,
    base: o.base,
    lang: o.lang,
    orchestratorName: o.orchestratorName,
    task: { original: o.task, english: o.taskEnglish },
    stageA: o.stageA,
    stage: "intake",
    haltReason: null,
    worktree: null,
    branch: null,
    specPath: null,
    tier: null,
    tierReasons: [],
    prUrl: null,
    iteration: 0,
    rung: 0,
    rejections: [],
    retries: {},
    questionsAnswered: 0,
    testAuthorAttempts: 0,
    executorQuestionRounds: 0,
    sealed: [],
    assumptions: [],
    previousFindings: [],
    minorFindings: [],
    claims: [],
    gateReport: null,
    awaitingRole: null,
    pendingJudgment: null,
    pendingWork: null,
    haltRole: null,
    finalized: false,
    ciSince: null,
    lastSpawn: {},
    children: [],
    createdAt: ts,
    updatedAt: ts
  });
}
function saveRun(dir, run2) {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, "run.json");
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(Run.parse(run2), null, 2)}
`);
  renameSync(tmp, target);
}
function loadRun(dir) {
  return Run.parse(JSON.parse(readFileSync(join(dir, "run.json"), "utf8")));
}
function transition(run2, to, now, reason2) {
  if (to === "halted") {
    if (run2.stage === "done" || run2.stage === "halted")
      throw new Error(`cannot halt a run in stage ${run2.stage}`);
    if (!reason2) throw new Error("halting requires a reason");
    return { ...run2, stage: to, haltReason: reason2, updatedAt: now.toISOString() };
  }
  if (!NEXT[run2.stage].includes(to)) throw new Error(`illegal transition ${run2.stage} -> ${to}`);
  return { ...run2, stage: to, updatedAt: now.toISOString() };
}
var EventKind = external_exports.enum([
  "stage",
  "assignment",
  "report",
  "question",
  "answer",
  "verdict",
  "escalation",
  "note"
]);
function appendEvent(dir, event) {
  EventKind.parse(event.kind);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify(event)}
`);
}

// src/pipeline/assess.ts
var MODEL_EFFORT = `[A-Za-z0-9.-]+/(${EFFORTS.join("|")})`;
var EXPECTED_ASSIGNMENT = `expected "<model>/<effort>" (effort: ${EFFORTS.join("|")})`;
var ModelEffortText = external_exports.string().regex(new RegExp(`^${MODEL_EFFORT}$`), EXPECTED_ASSIGNMENT);
var SkippableText = external_exports.string().regex(new RegExp(`^(skip|${MODEL_EFFORT})$`), `${EXPECTED_ASSIGNMENT} or "skip"`);
var RoleRow = external_exports.object({
  planner: ModelEffortText,
  "test-author": SkippableText,
  executor: ModelEffortText,
  verifier: ModelEffortText,
  retro: ModelEffortText
}).strict();
var Risk = external_exports.enum(["low", "medium", "high"]);
var Rubric = external_exports.object({
  version: external_exports.literal(1),
  tiers: external_exports.object({
    light: external_exports.object({ max_files: external_exports.number().int().min(0), risk: external_exports.array(Risk) }).strict(),
    heavy: external_exports.object({ min_files: external_exports.number().int().min(1), risk: external_exports.array(Risk) }).strict()
  }).strict(),
  assignments: external_exports.object({ light: RoleRow, standard: RoleRow, heavy: RoleRow }).strict(),
  escalation: external_exports.array(
    external_exports.string().regex(
      /^(effort\+1|model:[A-Za-z0-9.-]+|halt)$/,
      'expected "effort+1", "model:<model>" or "halt"'
    )
  ),
  caps: external_exports.object({
    rejections: external_exports.number().int().min(1),
    planner_questions: external_exports.number().int().min(0),
    test_author_attempts: external_exports.number().int().min(1),
    child_retries: external_exports.number().int().min(0),
    ci_wait_minutes: external_exports.number().int().min(1),
    executor_questions: external_exports.number().int().min(0),
    spec_critic: external_exports.object({ light: external_exports.number().int().min(1), default: external_exports.number().int().min(1) }).strict()
  }).strict(),
  sensitive_paths: external_exports.array(external_exports.string()),
  cross_repo_markers: external_exports.array(external_exports.string()),
  slicing: external_exports.object({
    enabled: external_exports.boolean(),
    min_criteria: external_exports.number().int().min(1),
    min_files: external_exports.number().int().min(1)
  }).strict()
}).strict();
var isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function merge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === void 0 ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}
var reason = (err) => err instanceof Error ? err.message : String(err);
function parseYaml(text2, what) {
  try {
    return (0, import_yaml2.parse)(text2);
  } catch (err) {
    throw new Error(`${what} is not valid YAML: ${reason(err)}`, { cause: err });
  }
}
var describeIssues = (err) => err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
function assertPatternsCompile(key, list2) {
  for (const entry of list2) {
    try {
      new RegExp(entry);
    } catch (err) {
      throw new Error(
        `${key} entry ${JSON.stringify(entry)} is not a valid regular expression: ${reason(err)}`,
        { cause: err }
      );
    }
  }
}
function loadRubric(defaultText, projectText) {
  const over = projectText ? parseYaml(projectText, "the project rubric") : void 0;
  const parsed = Rubric.safeParse(
    merge(parseYaml(defaultText, "the default rubric"), over ?? void 0)
  );
  if (!parsed.success) throw new Error(`invalid rubric: ${describeIssues(parsed.error)}`);
  const rubric = parsed.data;
  for (const row of Object.values(rubric.assignments)) {
    for (const text2 of Object.values(row)) {
      if (text2 !== "skip") modelFamily(text2.slice(0, text2.indexOf("/")));
    }
  }
  for (const step2 of rubric.escalation) {
    if (step2.startsWith("model:")) modelFamily(step2.slice("model:".length));
  }
  assertPatternsCompile("sensitive_paths", rubric.sensitive_paths);
  assertPatternsCompile("cross_repo_markers", rubric.cross_repo_markers);
  const { escalation, tiers } = rubric;
  if (escalation.length === 0) throw new Error("escalation must list at least one step");
  if (escalation.some((step2, i) => step2 === "halt" && i !== escalation.length - 1)) {
    throw new Error("escalation: halt must be the last step");
  }
  if (tiers.light.max_files >= tiers.heavy.min_files) {
    throw new Error(
      `tiers.light.max_files (${tiers.light.max_files}) must be below tiers.heavy.min_files (${tiers.heavy.min_files})`
    );
  }
  return rubric;
}
function readRisk(value) {
  const v = value?.trim().toLowerCase();
  if (v === "low" || v === "medium") return { risk: v, note: null };
  if (v === "high" || v === "critical") return { risk: "high", note: null };
  const note = v ? `risk ${JSON.stringify(value?.trim())} not recognised, treated as medium` : "risk not set, treated as medium";
  return { risk: "medium", note };
}
var ContractShape = external_exports.object({
  files: external_exports.array(external_exports.object({ path: external_exports.string().min(1), action: external_exports.string().optional() })).min(1),
  criteria: external_exports.array(external_exports.object({ id: external_exports.string().min(1) })).min(1)
});
function readContract(specText) {
  const block = extractContractBlock(specText);
  if (block === null) throw new Error("spec has no spec-contract block");
  const parsed = ContractShape.safeParse(parseYaml(block, "the spec-contract block"));
  if (!parsed.success) {
    throw new Error(`spec-contract block is invalid: ${describeIssues(parsed.error)}`);
  }
  return parsed.data;
}
function readSignals(specText, rubric) {
  const text2 = specText.replace(/\r\n?/g, "\n");
  const { frontmatter } = parseFrontmatter(text2);
  const { files, criteria } = readContract(text2);
  const paths = files.map((f) => f.path);
  const sensitive = rubric.sensitive_paths.map((r) => new RegExp(r));
  const { risk, note } = readRisk(frontmatter.risk ?? frontmatter.severity);
  return {
    risk,
    riskNote: note,
    bugfix: frontmatter.type === "bugfix" || Object.hasOwn(frontmatter, "severity"),
    files: files.length,
    newFiles: files.filter((f) => f.action === "new").length,
    criteria: criteria.length,
    paths,
    sensitive: paths.filter((p) => sensitive.some((re) => re.test(p))),
    crossRepo: rubric.cross_repo_markers.filter((m) => new RegExp(m).test(text2))
  };
}
function tierFor(s, r) {
  const heavy = [];
  if (r.tiers.heavy.risk.includes(s.risk)) heavy.push(`risk ${s.risk}`);
  if (s.files >= r.tiers.heavy.min_files) heavy.push(`${s.files} contract files`);
  heavy.push(
    ...s.sensitive.map((p) => `sensitive path ${p}`),
    ...s.crossRepo.map((m) => `cross-repo marker ${m}`)
  );
  if (heavy.length) return { tier: "heavy", reasons: s.riskNote ? [...heavy, s.riskNote] : heavy };
  const base = [s.riskNote ?? `risk ${s.risk}`, `${s.files} contract files`];
  if (r.tiers.light.risk.includes(s.risk) && s.files <= r.tiers.light.max_files) {
    return { tier: "light", reasons: base };
  }
  return { tier: "standard", reasons: base };
}
var toAssignment = (text2) => {
  const [model = "", effort = ""] = text2.split("/");
  return { model, effort };
};
var HaltError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "HaltError";
  }
};
var exhausted = (rung) => new HaltError(`halt: the escalation ladder is exhausted at rung ${rung}`);
function assignmentFor(tier, role, rung, r) {
  if (!Number.isInteger(rung) || rung < 0) throw new Error(`invalid escalation rung: ${rung}`);
  const raw = r.assignments[tier][role];
  if (raw === "skip") {
    if (role !== "test-author") throw new Error(`role ${role} cannot be skipped`);
    return "skip";
  }
  let a = toAssignment(raw);
  if (role === "executor") {
    for (const step2 of r.escalation.slice(0, rung)) {
      if (step2 === "halt") throw exhausted(rung);
      if (step2 === "effort+1") {
        const next = Math.min(EFFORTS.indexOf(a.effort) + 1, EFFORTS.length - 1);
        a = { ...a, effort: EFFORTS[next] };
      } else a = { ...a, model: step2.slice("model:".length) };
    }
    if (rung > r.escalation.length) throw exhausted(rung);
  }
  modelFamily(a.model);
  return a;
}
var RANK = { haiku: 0, sonnet: 1, opus: 2 };
function enforceVerifierFloor(executor, verifier) {
  const model = RANK[modelFamily(verifier.model)] >= RANK[modelFamily(executor.model)] ? verifier.model : executor.model;
  const effort = EFFORTS[Math.max(EFFORTS.indexOf(executor.effort), EFFORTS.indexOf(verifier.effort))];
  return { model, effort };
}
var fingerprint = (f) => `${f.category}|${f.file ?? ""}|${f.criterion ?? ""}`;
var shouldAuthorTests = (run2, r) => assignmentFor(run2.tier ?? run2.stageA, "test-author", 0, r) !== "skip";
var criticCap = (run2, r) => (run2.tier ?? run2.stageA) === "light" ? r.caps.spec_critic.light : r.caps.spec_critic.default;
function previewAssignments(run2, r) {
  const tier = run2.tier ?? run2.stageA;
  const show = (a) => a === "skip" ? "skip" : `${a.model}/${a.effort}`;
  const executor = assignmentFor(tier, "executor", 0, r);
  return {
    planner: show(assignmentFor(tier, "planner", 0, r)),
    "test-author": show(assignmentFor(tier, "test-author", 0, r)),
    executor: show(executor),
    verifier: show(enforceVerifierFloor(executor, assignmentFor(tier, "verifier", 0, r))),
    retro: show(assignmentFor(tier, "retro", 0, r))
  };
}

// src/pipeline/learning.ts
var import_yaml3 = __toESM(require_dist());

// src/storage/slug.ts
function slugify(title, maxLen = 40) {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  if (base.length <= maxLen) return base;
  const cut = base.slice(0, maxLen);
  const lastHyphen = cut.lastIndexOf("-");
  return lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut;
}
function isSafeBranchRef(name) {
  if (!name || name === "@") return false;
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/")) return false;
  if (name.endsWith(".")) return false;
  if (/[\u0000-\u0020\u007F~^:?*[\\]/.test(name)) return false;
  if (name.includes("..") || name.includes("//") || name.includes("@{")) return false;
  for (const segment of name.split("/")) {
    if (!segment || segment.startsWith(".") || segment.endsWith(".lock")) return false;
  }
  return true;
}

// src/storage/lessons.ts
var LESSON_TYPES = ["bug-pattern", "gotcha", "convention", "pitfall", "process"];
var INDEX_FILE = "MEMORY.md";
var INDEX_HEADER = [
  "# Marvin lessons",
  "",
  "Project memory \u2014 lessons learned during task execution and debugging, captured by the",
  "`lessons` MCP tool and shared with the team via git. One line per lesson; the body lives",
  "in the linked file. Recalled at task intake.",
  ""
].join("\n");
function uniqueSlug(memoryDir, base) {
  const root = base || "lesson";
  let slug = root;
  let n = 2;
  while (existsSync(join(memoryDir, `${slug}.md`))) {
    slug = `${root}-${n}`;
    n += 1;
  }
  return slug;
}
function addLesson(memoryDir, input) {
  mkdirSync(memoryDir, { recursive: true });
  const slug = uniqueSlug(memoryDir, slugify(input.title));
  const created = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);
  const frontmatter = {
    id: slug,
    type: input.type,
    title: input.title,
    created,
    tags: tags.length ? tags.join(", ") : void 0,
    source: input.source?.trim() || "manual"
  };
  const body = input.body.trim() ? `
${input.body.trim()}
` : "\n";
  const path = join(memoryDir, `${slug}.md`);
  writeFileSync(path, stringifyFrontmatter(frontmatter, body));
  appendIndex(memoryDir, { slug, type: input.type, title: input.title, created, tags });
  return { slug, path };
}
function appendIndex(memoryDir, entry) {
  const indexPath = join(memoryDir, INDEX_FILE);
  const tagsSuffix = entry.tags.length ? ` \xB7 ${entry.tags.join(", ")}` : "";
  const line = `- [${entry.title}](${entry.slug}.md) \u2014 ${entry.type} \xB7 ${entry.created}${tagsSuffix}`;
  let content = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : INDEX_HEADER;
  if (!content.endsWith("\n")) content += "\n";
  writeFileSync(indexPath, `${content}${line}
`);
}
function readAllLessons(memoryDir) {
  if (!existsSync(memoryDir)) return [];
  const lessons = [];
  for (const filename of readdirSync(memoryDir).sort()) {
    if (!filename.endsWith(".md") || filename === INDEX_FILE) continue;
    const raw = readFileSync(join(memoryDir, filename), "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    if (!frontmatter.title) continue;
    lessons.push({
      slug: filename.replace(/\.md$/, ""),
      type: frontmatter.type ?? "process",
      title: frontmatter.title,
      created: frontmatter.created ?? "",
      tags: frontmatter.tags ? frontmatter.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      source: frontmatter.source ?? "manual",
      body: body.trim()
    });
  }
  return lessons;
}
function titleWords(title) {
  return new Set(
    title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1)
  );
}
function titleSimilarity(a, b) {
  const wa = titleWords(a);
  const wb = titleWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let hits = 0;
  for (const w of wa) if (wb.has(w)) hits += 1;
  return hits / (wa.size + wb.size - hits);
}
var NEAR_DUPLICATE_THRESHOLD = 0.5;
function findNearDuplicate(memoryDir, title) {
  const slug = slugify(title);
  let best = null;
  for (const l of readAllLessons(memoryDir)) {
    const score = slug !== "" && (l.slug === slug || slugify(l.title) === slug) ? 1 : titleSimilarity(l.title, title);
    if (score >= NEAR_DUPLICATE_THRESHOLD && (!best || score > best.score)) {
      best = { lesson: l, score };
    }
  }
  return best?.lesson ?? null;
}
var SEVERITIES = ["blocker", "major", "minor"];
var MAX_BUFFER = 64 * 1024 * 1024;
var SUPERVISOR = `
const { spawn } = require("node:child_process");
const { constants } = require("node:os");
const child = spawn("/bin/sh", ["-c", process.argv[1]], { detached: true, stdio: "inherit" });
let stopping = false;
const signalGroup = (sig) => { try { process.kill(-child.pid, sig); } catch {} };
const stop = () => {
  if (stopping) return;
  stopping = true;
  signalGroup("SIGTERM");
  setTimeout(() => { signalGroup("SIGKILL"); process.exit(124); }, 1000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("SIGHUP", stop);
child.on("error", (e) => { process.stderr.write("error: " + e.message + "\\n"); process.exit(127); });
child.on("exit", (code, signal) => {
  if (stopping) signalGroup("SIGKILL");
  process.exit(code ?? 128 + (constants.signals[signal] ?? 0));
});
`;
var shellRunner = (command, cwd, timeoutMs) => {
  const started = Date.now();
  const r = spawnSync(process.execPath, ["-e", SUPERVISOR, "--", command], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER
  });
  const timedOut = r.error?.code === "ETIMEDOUT";
  const launch = timedOut ? `error: timed out after ${timeoutMs}ms
` : r.error ? `error: ${r.error.message}
` : "";
  return {
    code: timedOut ? 124 : r.status ?? 124,
    output: `${r.stdout ?? ""}${r.stderr ?? ""}${launch}`,
    ms: Date.now() - started
  };
};
var relevantTail = (s) => {
  const lines = s.trimEnd().split("\n");
  const errors = lines.filter((l) => /\berror\b|\bfail(ed|ure)?\b|✗|×/i.test(l)).slice(-20);
  return (errors.length ? errors : lines.slice(-40)).join("\n");
};
function runGates(commands, cwd, run2, timeoutMs) {
  return commands.map(({ name, command, retry: retry2 = true }) => {
    const first = run2(command, cwd, timeoutMs);
    if (first.code === 0) return { name, result: "pass", ms: first.ms, tail: "" };
    if (!retry2) return { name, result: "fail", ms: first.ms, tail: relevantTail(first.output) };
    const second = run2(command, cwd, timeoutMs);
    if (second.code === 0) {
      return { name, result: "flaky", ms: first.ms + second.ms, tail: relevantTail(first.output) };
    }
    return { name, result: "fail", ms: first.ms + second.ms, tail: relevantTail(second.output) };
  });
}
var C_ESCAPES = {
  '"': 34,
  "\\": 92,
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13
};
function cUnquote(quoted) {
  if (quoted.length < 2 || !quoted.startsWith('"') || !quoted.endsWith('"')) return quoted;
  const chars = Array.from(quoted.slice(1, -1));
  const bytes = [];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i] ?? "";
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(chars.slice(i + 1, i + 4).join(""))?.[0];
    if (octal) {
      bytes.push(parseInt(octal, 8) & 255);
      i += octal.length;
      continue;
    }
    const escaped = C_ESCAPES[chars[i + 1] ?? ""];
    if (escaped !== void 0) {
      bytes.push(escaped);
      i += 1;
      continue;
    }
    bytes.push(92);
  }
  return Buffer.from(bytes).toString("utf8");
}
function addedLines(diff) {
  const out = [];
  let file = "";
  let next = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of diff.split("\n")) {
    if (oldLeft > 0 || newLeft > 0) {
      if (raw.startsWith("+")) {
        out.push({ file, line: next, text: raw.slice(1) });
        next += 1;
        newLeft -= 1;
      } else if (raw.startsWith("-")) {
        oldLeft -= 1;
      } else if (!raw.startsWith("\\")) {
        next += 1;
        oldLeft -= 1;
        newLeft -= 1;
      }
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const name = raw.slice(4);
      file = (name.startsWith('"') ? cUnquote(name) : name.replace(/\t.*$/, "")).replace(
        /^b\//,
        ""
      );
      continue;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (hunk) {
      oldLeft = hunk[1] === void 0 ? 1 : Number(hunk[1]);
      next = Number(hunk[2]);
      newLeft = hunk[3] === void 0 ? 1 : Number(hunk[3]);
    }
  }
  return out;
}
var CHECK_BUDGET_MS = 2e3;
var MATCH_LINES = new Script(`(() => {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (only !== null && !only.test(line.file)) continue;
    if (skip !== null && skip.test(line.file)) continue;
    if (re.test(line.text)) out.push(i);
  }
  return out;
})()`);
function scanChecks(lines, rules, budgetMs = CHECK_BUDGET_MS) {
  const hits = [];
  const context = createContext({ lines, re: null, only: null, skip: null });
  for (const rule of rules) {
    context.re = new RegExp(rule.pattern);
    context.only = rule.path_pattern ? new RegExp(rule.path_pattern) : null;
    context.skip = rule.exclude_pattern ? new RegExp(rule.exclude_pattern) : null;
    let matched;
    try {
      matched = MATCH_LINES.runInContext(context, { timeout: budgetMs });
    } catch (error) {
      if (error.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw error;
      hits.push({
        id: rule.id,
        file: "",
        line: 0,
        text: "",
        message: `check ${rule.id} exceeded its ${budgetMs / 1e3} s time budget`,
        severity: "blocker",
        category: "gate",
        timedOut: true
      });
      continue;
    }
    for (const i of matched) {
      const l = lines[i];
      hits.push({
        id: rule.id,
        file: l.file,
        line: l.line,
        text: l.text.trim(),
        message: rule.message,
        severity: rule.severity ?? "major",
        category: rule.category ?? "convention"
      });
    }
  }
  return hits;
}
var MARVIN_RECORDS = /^\.marvin\/(?:task|metrics|critique)\//;
function undeclaredFiles(changed, declared, exemptPattern) {
  const known = new Set(declared);
  const exempt = exemptPattern ? new RegExp(exemptPattern) : null;
  return [...new Set(changed)].filter(
    (f) => !known.has(f) && !MARVIN_RECORDS.test(f) && !exempt?.test(f)
  );
}
function compileProtected(patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error("protectedPatterns must be a non-empty array of regex strings");
  }
  return patterns.map((source) => {
    if (typeof source !== "string") throw new Error("protectedPatterns must hold only strings");
    return new RegExp(source, "i");
  });
}
var isProtectedPath = (res, path) => res.some((re) => re.test(path) || !path.endsWith("/") && re.test(`${path}/`));
function protectedChanges(changed, patterns) {
  const res = compileProtected(patterns);
  return [...new Set(changed)].filter((f) => isProtectedPath(res, f));
}
var sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
var sha256File = (path) => sha256Bytes(readFileSync(path));
function checkSealed(worktree, sealed) {
  return sealed.map((s) => {
    try {
      return { path: s.path, ok: sha256File(join(worktree, s.path)) === s.sha256 };
    } catch {
      return { path: s.path, ok: false };
    }
  });
}
var fingerprint2 = (abs) => {
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) return `link:${readlinkSync(abs)}`;
    if (st.isDirectory()) return "dir";
    return sha256File(abs);
  } catch {
    return "missing";
  }
};
var nul = (s) => s.split("\0").filter(Boolean);
var NESTED_REPO = "nested-repo";
var HARDENED_GIT_OPTIONS = [
  "--no-replace-objects",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false"
];
var GIT_ENV_KEPT = /* @__PURE__ */ new Set([
  "GIT_EXEC_PATH",
  "GIT_ASKPASS",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_SSH_VARIANT",
  "GIT_TERMINAL_PROMPT",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM"
]);
function hardenedGitEnv(extraEnv = {}, inherited = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (!key.startsWith("GIT_") || GIT_ENV_KEPT.has(key)) env[key] = value;
  }
  Object.assign(env, extraEnv);
  env.GIT_NO_REPLACE_OBJECTS = "1";
  return env;
}
function isolatedGit(worktree, gitDir, extraEnv = {}) {
  const env = hardenedGitEnv(extraEnv);
  env.GIT_DIR = gitDir;
  env.GIT_WORK_TREE = worktree;
  const run2 = (args, input) => execFileSync("git", [...HARDENED_GIT_OPTIONS, "-c", "core.quotePath=false", ...args], {
    cwd: worktree,
    env,
    maxBuffer: MAX_BUFFER,
    input,
    stdio: [input === void 0 ? "ignore" : "pipe", "pipe", "pipe"]
  });
  return {
    text: (...args) => run2(args).toString("utf8"),
    bytes: (...args) => run2(args),
    textIn: (input, ...args) => run2(args, input).toString("utf8")
  };
}
function snapshotProtected(worktree, gitDir, patterns) {
  const res = compileProtected(patterns);
  const git4 = isolatedGit(worktree, gitDir);
  const names = /* @__PURE__ */ new Set();
  for (const args of [
    ["ls-files", "-z", "--cached"],
    ["ls-files", "-z", "--others", "--exclude-standard"],
    ["ls-files", "-z", "--others", "--ignored", "--exclude-standard"]
  ]) {
    for (const name of nul(git4.text(...args))) names.add(name);
  }
  for (const entry of nul(git4.text("ls-files", "-s", "-z"))) {
    const gitlink = /^160000 [0-9a-f]+ \d\t([\s\S]+)$/.exec(entry)?.[1];
    if (gitlink !== void 0) names.add(`${gitlink}/`);
  }
  const out = {};
  for (const name of [...names].sort()) {
    if (name.endsWith("/")) out[name] = NESTED_REPO;
    else if (isProtectedPath(res, name)) out[name] = fingerprint2(join(worktree, name));
  }
  return out;
}
function diffProtected(a, b) {
  const keys = /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}
function addedLineMismatches(lines, numstat) {
  const parsed = /* @__PURE__ */ new Map();
  for (const l of lines) parsed.set(l.file, (parsed.get(l.file) ?? 0) + 1);
  const counted = /* @__PURE__ */ new Map();
  const binary = /* @__PURE__ */ new Set();
  for (const record of nul(numstat)) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(record);
    if (m?.[3] === void 0) continue;
    if (m[1] === "-") binary.add(m[3]);
    else counted.set(m[3], Number(m[1]));
  }
  const paths = /* @__PURE__ */ new Set([...parsed.keys(), ...counted.keys()]);
  return [...paths].filter((f) => !binary.has(f) && (parsed.get(f) ?? 0) !== (counted.get(f) ?? 0)).sort();
}
function buildReport(parts) {
  const passed = parts.gates.every((g) => g.result === "pass" || g.result === "flaky") && parts.undeclared.length === 0 && parts.protected.length === 0 && parts.checks.every((c) => c.severity === "minor") && parts.sealed.every((s) => s.ok) && parts.blockers.length === 0;
  return { ...parts, passed };
}
function reportFindings(r) {
  const out = [];
  for (const g of r.gates) {
    if (g.result === "not-run") {
      out.push({
        id: `G-${g.name}-not-run`,
        severity: "blocker",
        category: "gate",
        claim: `${g.name} was not run`,
        evidence: g.tail,
        expected: `${g.name} passes`
      });
    }
    if (g.result === "fail" && !g.name.startsWith("prepare:")) {
      out.push({
        id: `G-${g.name}`,
        severity: "blocker",
        category: "gate",
        claim: `${g.name} fails`,
        evidence: g.tail,
        expected: `${g.name} passes`
      });
    }
    if (g.result === "flaky") {
      out.push({
        id: `G-${g.name}-flaky`,
        severity: "minor",
        category: "gate",
        claim: `${g.name} failed once and passed on re-run`,
        evidence: g.tail,
        expected: "deterministic pass"
      });
    }
  }
  r.undeclared.forEach(
    (f, i) => out.push({
      id: `S-${i + 1}`,
      severity: "major",
      category: "scope",
      file: f,
      claim: `${f} changed outside the spec contract`,
      evidence: "git diff --name-only",
      expected: "only contract files and sealed tests change"
    })
  );
  r.protected.forEach((f, i) => {
    const sources = r.protectedSources[f] ?? ["committed diff"];
    const duringGates = sources.every((source) => source === "post-gate snapshot");
    out.push({
      id: `P-${i + 1}`,
      severity: "blocker",
      category: "scope",
      file: f,
      claim: duringGates ? `protected path ${f} changed during gates` : `${f} is a protected path`,
      evidence: sources.join(", "),
      expected: `no changes to protected paths (patterns: ${r.protectedPatterns.join(", ")})`
    });
  });
  r.checks.forEach(
    (c, i) => out.push(
      c.timedOut ? {
        id: `C-${c.id}-${i + 1}`,
        severity: c.severity,
        category: c.category,
        claim: c.message,
        evidence: "the check's matching was interrupted at its time budget",
        expected: `check ${c.id} finishes within its time budget`
      } : {
        id: `C-${c.id}-${i + 1}`,
        severity: c.severity,
        category: c.category,
        file: c.file,
        line: c.line,
        claim: c.message,
        evidence: c.text,
        expected: `no match for check ${c.id}`
      }
    )
  );
  for (const s of r.sealed) {
    if (!s.ok) {
      out.push({
        id: `T-${s.path}`,
        severity: "blocker",
        category: "test-quality",
        file: s.path,
        claim: "sealed acceptance test was modified or removed",
        evidence: "sha256 mismatch",
        expected: "sealed tests unchanged; dispute them through needs_input"
      });
    }
  }
  r.blockers.forEach(
    (b, i) => out.push({
      id: `B-${i + 1}`,
      severity: "blocker",
      category: b.category,
      ...b.file === void 0 ? {} : { file: b.file },
      claim: b.claim,
      evidence: b.evidence,
      expected: b.expected
    })
  );
  return out;
}
var MAX_UNCOMMITTED_FINDINGS = 100;
var PATCH_FLAGS = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--text",
  "--no-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/"
];
function isCanonicalPath(path) {
  return typeof path === "string" && path !== "" && !path.startsWith("/") && !path.includes("\\") && // eslint-disable-next-line no-control-regex
  !/[\u0000-\u001f\u007f]/.test(path) && path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..") && posix.normalize(path) === path;
}
function validateOptions(o) {
  if (!/^[0-9a-f]{40}$/.test(o.baseSha)) throw new Error("baseSha must be a 40-hex commit SHA");
  if (!isAbsolute(o.gitDir)) throw new Error("gitDir must be an absolute path");
  if (!isAbsolute(o.worktree)) throw new Error("worktree must be an absolute path");
  compileProtected(o.protectedPatterns);
  for (const path of o.sealed.map((x) => x.path)) {
    if (!isCanonicalPath(path)) throw new Error(`sealed path is not canonical: ${String(path)}`);
  }
  for (const path of o.contractFiles) {
    if (!isCanonicalPath(path)) throw new Error(`contract file is not canonical: ${String(path)}`);
  }
  const baseline = o.protectedBaseline;
  if (typeof baseline !== "object" || baseline === null || Array.isArray(baseline) || Object.values(baseline).some((v) => typeof v !== "string")) {
    throw new Error("protectedBaseline must be a snapshotProtected record");
  }
}
function pointerProblem(worktree, gitDir) {
  try {
    const dotGit = join(worktree, ".git");
    if (!lstatSync(dotGit).isFile()) return ".git is not a file";
    const target = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(readFileSync(dotGit, "utf8"))?.[1];
    if (target === void 0) return ".git holds no gitdir line";
    return realpathSync(resolve(worktree, target)) === realpathSync(gitDir) ? null : `.git points at ${target}`;
  } catch (error) {
    return `.git cannot be read (${error instanceof Error ? error.message : String(error)})`;
  }
}
function runGateStage(o) {
  validateOptions(o);
  const git4 = isolatedGit(o.worktree, o.gitDir);
  const blockers = [];
  const protectedRes = compileProtected(o.protectedPatterns);
  const exempt = o.exemptPattern ? new RegExp(o.exemptPattern) : null;
  const sealedPaths = new Set(o.sealed.map((s) => s.path));
  const tolerated = (path) => path.endsWith("/") ? o.protectedBaseline[path] === NESTED_REPO : exempt !== null && exempt.test(path) && !sealedPaths.has(path) && !isProtectedPath(protectedRes, path);
  const hiddenByIndex = () => new Set(
    nul(git4.text("ls-files", "-v", "-z")).filter((record) => {
      const tag = record.charAt(0);
      return tag !== tag.toUpperCase() || tag === "S";
    }).map((record) => record.slice(2))
  );
  const nestedRepo = (path) => ({
    category: "scope",
    claim: `nested git repository: ${path.slice(0, -1)}`,
    file: path.slice(0, -1),
    evidence: "git lists the directory and does not look inside it",
    expected: "no embedded git repository beyond those present when the run started"
  });
  const headSha = git4.text("rev-parse", "--verify", "HEAD^{commit}").trim();
  git4.text("cat-file", "-e", `${o.baseSha}^{commit}`);
  const range = `${o.baseSha}...${headSha}`;
  const pointerBefore = pointerProblem(o.worktree, o.gitDir);
  if (pointerBefore !== null) {
    blockers.push({
      category: "scope",
      claim: "worktree .git pointer was changed",
      file: ".git",
      evidence: pointerBefore,
      expected: "the worktree's .git points at the git dir recorded when the run started"
    });
  }
  const flagsBefore = hiddenByIndex();
  for (const path of flagsBefore) {
    blockers.push({
      category: "scope",
      claim: `index flag hides changes: ${path}`,
      file: path,
      evidence: "git ls-files -v marks the entry assume-unchanged or skip-worktree",
      expected: "no assume-unchanged or skip-worktree entries: they blind every status check"
    });
  }
  const status2 = (untracked) => nul(
    git4.text("status", "--porcelain=v1", "-z", `--untracked-files=${untracked}`, "--no-renames")
  ).map((record) => ({ xy: record.slice(0, 2), path: record.slice(3) }));
  const dirtyBefore = status2("all");
  const untolerated = dirtyBefore.filter((e) => !tolerated(e.path));
  for (const e of untolerated.slice(0, MAX_UNCOMMITTED_FINDINGS)) {
    blockers.push({
      category: "scope",
      claim: `uncommitted work: ${e.path}`,
      file: e.path,
      evidence: `git status --porcelain (${e.xy.trim() || "?"})`,
      expected: "everything the run produced is committed; the gate judges the committed HEAD"
    });
  }
  if (untolerated.length > MAX_UNCOMMITTED_FINDINGS) {
    blockers.push({
      category: "scope",
      claim: `uncommitted work: ${untolerated.length - MAX_UNCOMMITTED_FINDINGS} more paths`,
      evidence: "git status --porcelain",
      expected: "everything the run produced is committed; the gate judges the committed HEAD"
    });
  }
  const changed = nul(git4.text("diff", "--name-only", "-z", "--no-renames", range));
  const sources = /* @__PURE__ */ new Map();
  const flag2 = (path, source) => {
    sources.set(path, [...sources.get(path) ?? [], source]);
  };
  for (const path of protectedChanges(changed, o.protectedPatterns)) flag2(path, "committed diff");
  const protectedBefore = snapshotProtected(o.worktree, o.gitDir, o.protectedPatterns);
  for (const path of diffProtected(o.protectedBaseline, protectedBefore)) {
    if (!path.endsWith("/")) flag2(path, "protected snapshot");
    else if (protectedBefore[path] === NESTED_REPO) blockers.push(nestedRepo(path));
  }
  const patch = git4.text("diff", "--unified=0", ...PATCH_FLAGS, range);
  const added = addedLines(patch);
  const numstat = git4.text("diff", "--numstat", "-z", "--text", "--no-renames", range);
  for (const path of addedLineMismatches(added, numstat)) {
    blockers.push({
      category: "gate",
      claim: `check diff could not be parsed for ${path}`,
      file: path,
      evidence: "added lines read from the patch differ from git diff --numstat",
      expected: "the scan for leftover constructs sees every added line"
    });
  }
  const sealedBefore = o.sealed.map((s) => {
    try {
      return {
        path: s.path,
        ok: sha256Bytes(git4.bytes("cat-file", "blob", `${headSha}:${s.path}`)) === s.sha256
      };
    } catch {
      return { path: s.path, ok: false };
    }
  });
  const sealedOnDisk = checkSealed(o.worktree, o.sealed);
  const runnable = o.oracles.flatMap(
    (x) => x.command === null ? [] : [{ criterion: x.criterion, command: x.command }]
  );
  for (const x of o.oracles) {
    if (x.command !== null) continue;
    blockers.push({
      category: "gate",
      claim: `criterion ${x.criterion} has no runnable oracle: ${x.reason ?? "unresolved"}`,
      evidence: "spec-contract oracle resolution",
      expected: "every criterion that is not prose-review resolves to a command"
    });
  }
  const prepareGates = [];
  let prepareFailed = null;
  for (const step2 of o.prepare ?? []) {
    const name = `prepare:${step2.name}`;
    if (prepareFailed !== null) {
      prepareGates.push({
        name,
        result: "not-run",
        ms: 0,
        tail: `prepare step ${prepareFailed} failed`
      });
      continue;
    }
    const ran = runGates(
      [{ name, command: step2.command, retry: false }],
      o.worktree,
      o.run,
      o.timeoutMs
    );
    prepareGates.push(...ran);
    const failure = ran.find((r) => r.result === "fail");
    if (failure !== void 0) {
      prepareFailed = step2.name;
      blockers.push({
        category: "gate",
        claim: `prepare step ${step2.name} failed`,
        evidence: failure.tail,
        expected: "prepare steps succeed before the oracles run"
      });
    }
  }
  const aroundOracle = /* @__PURE__ */ new Set();
  const oracleGates = [];
  for (const x of prepareFailed === null ? runnable : []) {
    const before = checkSealed(o.worktree, o.sealed).filter((f) => !f.ok);
    oracleGates.push(
      ...runGates(
        [{ name: `oracle:${x.criterion}`, command: x.command, retry: false }],
        o.worktree,
        o.run,
        o.timeoutMs
      )
    );
    const after = checkSealed(o.worktree, o.sealed).filter((f) => !f.ok);
    for (const path of new Set([...before, ...after].map((f) => f.path))) {
      aroundOracle.add(path);
      blockers.push({
        category: "scope",
        claim: `sealed file ${path} changed around oracle ${x.criterion}`,
        file: path,
        evidence: "sha256 differs from the sealed value just before or after the oracle ran",
        expected: "sealed tests are byte-identical while their oracles run"
      });
    }
  }
  if (prepareFailed !== null) {
    for (const x of runnable) {
      oracleGates.push({
        name: `oracle:${x.criterion}`,
        result: "not-run",
        ms: 0,
        tail: `prepare step ${prepareFailed} failed`
      });
    }
  }
  const gates = [
    ...prepareGates,
    ...oracleGates,
    ...runGates(o.gates, o.worktree, o.run, o.timeoutMs)
  ];
  const headAfter = git4.text("rev-parse", "--verify", "HEAD^{commit}").trim();
  if (headAfter !== headSha) {
    blockers.push({
      category: "scope",
      claim: "HEAD moved during gates",
      evidence: `${headSha} -> ${headAfter}`,
      expected: "the gates leave the committed HEAD alone"
    });
  }
  for (const path of hiddenByIndex()) {
    if (flagsBefore.has(path)) continue;
    blockers.push({
      category: "scope",
      claim: `gates set an index flag on ${path}`,
      file: path,
      evidence: "git ls-files -v marks the entry assume-unchanged or skip-worktree",
      expected: "the gates leave the index flags alone"
    });
  }
  const seenBefore = new Set(dirtyBefore.map((e) => `${e.xy}\0${e.path}`));
  for (const e of status2("no")) {
    if (seenBefore.has(`${e.xy}\0${e.path}`) || tolerated(e.path)) continue;
    blockers.push({
      category: "scope",
      claim: `gates modified tracked file ${e.path}`,
      file: e.path,
      evidence: `git status --porcelain (${e.xy.trim() || "?"})`,
      expected: "the gates may create untracked artefacts but not touch tracked files"
    });
  }
  const pointerAfter = pointerProblem(o.worktree, o.gitDir);
  if (pointerBefore === null && pointerAfter !== null) {
    blockers.push({
      category: "scope",
      claim: "worktree .git pointer was changed during gates",
      file: ".git",
      evidence: pointerAfter,
      expected: "the worktree's .git points at the git dir recorded when the run started"
    });
  }
  const sealedAfter = checkSealed(o.worktree, o.sealed);
  const sealed = sealedBefore.map((before, i) => {
    const after = sealedAfter[i];
    if (before.ok && sealedOnDisk[i]?.ok && after !== void 0 && !after.ok) {
      blockers.push({
        category: "scope",
        claim: `sealed file ${before.path} changed during gates`,
        file: before.path,
        evidence: "sha256 differs from the sealed value after the gates ran",
        expected: "sealed tests unchanged by the gates"
      });
    }
    return {
      path: before.path,
      ok: before.ok && after?.ok === true && !aroundOracle.has(before.path)
    };
  });
  const protectedAfter = snapshotProtected(o.worktree, o.gitDir, o.protectedPatterns);
  for (const path of diffProtected(protectedBefore, protectedAfter)) {
    if (!path.endsWith("/")) flag2(path, "post-gate snapshot");
    else if (protectedAfter[path] === NESTED_REPO) blockers.push(nestedRepo(path));
  }
  const protectedPaths = [...sources.keys()].sort();
  return buildReport({
    gates,
    undeclared: undeclaredFiles(
      changed,
      [...o.contractFiles, ...o.sealed.map((s) => s.path)],
      o.exemptPattern
    ),
    protected: protectedPaths,
    protectedSources: Object.fromEntries(sources),
    protectedPatterns: [...o.protectedPatterns],
    checks: scanChecks(added, o.checks),
    sealed,
    blockers
  });
}

// src/lib/shell-quote.ts
var shellQuote = (word) => `'${word.replaceAll("'", "'\\''")}'`;
function encodeForContext(value, context) {
  switch (context) {
    case "unquoted":
      return shellQuote(value);
    case "single":
      return value.replaceAll("'", "'\\''");
    case "double":
      return value.replace(/[\\"$`]/g, "\\$&");
    case "escaped":
      return value;
  }
}
function substitutePlaceholders(template, placeholders, replace) {
  let out = "";
  let quote = null;
  const at = (i) => placeholders.find((p) => template.startsWith(p, i));
  for (let i = 0; i < template.length; i += 1) {
    const found = at(i);
    if (found) {
      out += replace(found, quote === "'" ? "single" : quote === '"' ? "double" : "unquoted");
      i += found.length - 1;
      continue;
    }
    const ch = template[i] ?? "";
    if (quote === "'") {
      if (ch === "'") quote = null;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      const escaped = at(i + 1);
      if (escaped && quote === null) {
        out += ch + replace(escaped, "escaped");
        i += escaped.length;
        continue;
      }
      out += ch + (template[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (ch === '"') quote = quote === null ? '"' : null;
    else if (ch === "'" && quote === null) quote = "'";
    out += ch;
  }
  return out;
}
function fillShellTemplate(template, values) {
  return substitutePlaceholders(
    template,
    Object.keys(values),
    (placeholder, context) => encodeForContext(values[placeholder] ?? "", context)
  );
}
var git = (cwd, ...args) => execFileSync("git", [...HARDENED_GIT_OPTIONS, ...args], {
  cwd,
  env: hardenedGitEnv(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
}).trim();
var gitRaw = (cwd, ...args) => execFileSync("git", [...HARDENED_GIT_OPTIONS, ...args], {
  cwd,
  env: hardenedGitEnv(),
  stdio: ["ignore", "pipe", "pipe"]
});
function createRunWorktree(o) {
  const branch = `autopilot/${o.runId}`;
  const path = join(o.worktreesRoot, basename(o.repoRoot), o.runId);
  if (existsSync(path)) throw new Error(`worktree path exists: ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  git(o.repoRoot, "fetch", "origin", o.base);
  const baseSha = git(
    o.repoRoot,
    "rev-parse",
    "--verify",
    "--end-of-options",
    `refs/remotes/origin/${o.base}^{commit}`
  );
  git(o.repoRoot, "worktree", "add", "--no-track", "-b", branch, path, baseSha);
  const gitDir = git(path, "rev-parse", "--absolute-git-dir");
  return { path, branch, baseSha, gitDir };
}
function branchName(template, v) {
  return template.replace("{tracker}", v.tracker).replace("{slug}", v.slug);
}
function renameRunBranch(worktree, to) {
  const output = git(worktree, "ls-remote", "--heads", "origin", `refs/heads/${to}`);
  if (output) throw new Error(`branch ${to} already exists on origin`);
  git(worktree, "branch", "-m", to);
}
var FULL_SHA = /^[0-9a-f]{40}$/;
var TOOL_CACHES = /* @__PURE__ */ new Set([".cache", ".vite", ".vite-temp", ".vitest"]);
var BaseTreeError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "BaseTreeError";
  }
};
var errorCode = (error) => error?.code ?? (error instanceof Error ? error.message : String(error));
var within = (root, target) => {
  const rel = relative(root, target);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? null : rel;
};
function isPlainDirectory(root, rel) {
  let current = root;
  for (const part of rel.split("/")) {
    current = join(current, part);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
    } catch {
      return false;
    }
  }
  return true;
}
function linkNodeModules(git4, from, tree) {
  const roots = [.../* @__PURE__ */ new Set([from, realpathSync(from)])];
  const reroot = (link) => {
    if (!isAbsolute(link)) return link;
    for (const root of roots) {
      const rel = within(root, link);
      if (rel !== null) return join(tree, rel);
    }
    return link;
  };
  const shown2 = (path) => relative(from, path).split(sep).join("/");
  const mirror = (source, target, scopes) => {
    let entries;
    try {
      entries = readdirSync(source, { withFileTypes: true });
    } catch (error) {
      throw new BaseTreeError(`${shown2(source)} cannot be listed (${errorCode(error)})`);
    }
    try {
      mkdirSync(target);
    } catch (error) {
      throw new BaseTreeError(`${shown2(source)} cannot be mirrored (${errorCode(error)})`);
    }
    for (const entry of entries) {
      if (scopes && TOOL_CACHES.has(entry.name)) continue;
      const src = join(source, entry.name);
      const dst = join(target, entry.name);
      if (scopes && entry.isDirectory() && entry.name.startsWith("@")) {
        mirror(src, dst, false);
        continue;
      }
      try {
        symlinkSync(entry.isSymbolicLink() ? reroot(readlinkSync(src)) : src, dst);
      } catch (error) {
        throw new BaseTreeError(`${shown2(src)} cannot be linked (${errorCode(error)})`);
      }
    }
  };
  const listed = git4.text("ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory").split("\0").filter((entry) => entry.endsWith("/")).map((entry) => entry.slice(0, -1)).filter((rel) => {
    const parts = rel.split("/");
    return parts.at(-1) === "node_modules" && !parts.slice(0, -1).includes("node_modules");
  });
  for (const rel of listed) {
    const parent = posix.dirname(rel);
    if (parent !== "." && !isPlainDirectory(tree, parent)) continue;
    if (occupied(join(tree, rel)) || !isDirectory(join(from, rel))) continue;
    mirror(join(from, rel), join(tree, rel), true);
  }
}
function occupied(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
function recordOf(tree) {
  try {
    const pointer = readFileSync(join(tree, ".git"), "utf8");
    const target = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(pointer)?.[1];
    if (target === void 0) return null;
    const record = realpathSync(resolve(tree, target));
    if (basename(dirname(record)) !== "worktrees") return null;
    const back = resolve(record, readFileSync(join(record, "gitdir"), "utf8").trim());
    return realpathSync(back) === realpathSync(join(tree, ".git")) ? record : null;
  } catch {
    return null;
  }
}
function removeTemporaryWorktree(git4, tree, record) {
  try {
    git4.text("worktree", "remove", "--force", "--force", tree);
  } catch {
  }
  for (const path of record === null ? [tree] : [tree, record]) {
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 2 });
    } catch {
    }
  }
}
var baseTreesDir = (worktree) => join(dirname(worktree), `.base-${basename(worktree)}`);
function isLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
function clearLeftovers(git4, dir) {
  let entries = [];
  try {
    if (lstatSync(dir).isDirectory()) entries = readdirSync(dir);
    else rmSync(dir, { force: true });
  } catch {
  }
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
  }
  if (isLink(dir) || !isDirectory(dir)) {
    throw new BaseTreeError(`${dir} cannot be made a directory for the base trees`);
  }
  for (const name of entries) {
    const path = join(dir, name);
    try {
      rmSync(path, { recursive: true, force: true, maxRetries: 2 });
    } catch {
    }
    if (isLink(path)) continue;
    try {
      git4.text("worktree", "remove", "--force", "--force", path);
    } catch {
    }
  }
}
function withBaseWorktree(o, fn) {
  if (typeof o.commit !== "string" || !FULL_SHA.test(o.commit)) {
    throw new Error("the base commit must be a 40-hex commit SHA");
  }
  if (!isAbsolute(o.worktree) || !isAbsolute(o.gitDir)) {
    throw new Error("worktree and gitDir must be absolute paths");
  }
  const git4 = isolatedGit(o.worktree, o.gitDir);
  const dir = baseTreesDir(o.worktree);
  clearLeftovers(git4, dir);
  let tree;
  try {
    tree = mkdtempSync(join(dir, "t-"));
  } catch (error) {
    throw new BaseTreeError(`${dir} cannot hold a base tree (${errorCode(error)})`);
  }
  let record = null;
  try {
    git4.text("worktree", "add", "--detach", tree, o.commit);
    record = recordOf(tree);
    linkNodeModules(git4, o.worktree, tree);
    return fn(tree);
  } finally {
    removeTemporaryWorktree(git4, tree, record);
    try {
      rmdirSync(dir);
    } catch {
    }
  }
}
function snapshotTreeImpl(worktree) {
  const head = git(worktree, "rev-parse", "HEAD");
  const porcelainRaw = gitRaw(worktree, "status", "--porcelain=v1", "-z", "--untracked-files=all");
  const porcelainStr = porcelainRaw.toString("utf8");
  const entries = [];
  if (porcelainStr) {
    const records = porcelainStr.split("\0");
    let i = 0;
    while (i < records.length) {
      const record = records[i];
      if (!record) {
        i++;
        continue;
      }
      const xy = record.substring(0, 2);
      const path = record.substring(3);
      let orig = null;
      if ((xy[0] === "R" || xy[0] === "C") && i + 1 < records.length) {
        orig = records[i + 1] ?? null;
        i += 2;
      } else {
        i++;
      }
      let fingerprint3;
      try {
        const fprint = git(worktree, "hash-object", "--", join(worktree, path));
        fingerprint3 = fprint;
      } catch {
        try {
          execFileSync("test", ["-d", join(worktree, path)], {
            stdio: "ignore"
          });
          fingerprint3 = "dir";
        } catch {
          fingerprint3 = "missing";
        }
      }
      entries.push({ xy, path, orig, fingerprint: fingerprint3 });
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { head, entries };
}
function snapshotTree(worktree) {
  return JSON.stringify(snapshotTreeImpl(worktree));
}
function diffSnapshots(before, after) {
  const beforeData = JSON.parse(before);
  const afterData = JSON.parse(after);
  const beforeMap = /* @__PURE__ */ new Map();
  for (const entry of beforeData.entries) {
    const key = `${entry.xy}\0${entry.path}`;
    beforeMap.set(key, entry);
  }
  const afterMap = /* @__PURE__ */ new Map();
  for (const entry of afterData.entries) {
    const key = `${entry.xy}\0${entry.path}`;
    afterMap.set(key, entry);
  }
  const diff = [];
  if (beforeData.head !== afterData.head) {
    diff.push(`HEAD ${beforeData.head} -> ${afterData.head}`);
  }
  for (const [key, afterEntry] of afterMap) {
    const beforeEntry = beforeMap.get(key);
    if (!beforeEntry) {
      diff.push(`${afterEntry.xy} ${afterEntry.path}`);
    } else if (beforeEntry.fingerprint !== afterEntry.fingerprint) {
      diff.push(`${afterEntry.xy} ${afterEntry.path} (content changed)`);
    }
  }
  for (const [key, beforeEntry] of beforeMap) {
    if (!afterMap.has(key)) {
      diff.push(`removed ${beforeEntry.xy} ${beforeEntry.path}`);
    }
  }
  return diff;
}

// src/pipeline/seal.ts
var isReseal = (run2) => run2.iteration > 0;
var FILE = "{file}";
var FOREIGN_PLACEHOLDERS = ["{name}", "{ref}", "{path}"];
var NOT_ONE_WORD = /[`\r\n]|\$\(|<<|#/;
function placeholderIsQuoted(template) {
  let quoted = false;
  substitutePlaceholders(template, [FILE], (placeholder, context) => {
    if (context !== "unquoted") quoted = true;
    return placeholder;
  });
  return quoted;
}
function formatTestOne(template, path) {
  if (FOREIGN_PLACEHOLDERS.some((placeholder) => template.includes(placeholder))) {
    throw new Error(
      "gates.test_one must not contain {name}, {ref} or {path}: the seal stage runs a whole test file, so name it with {file} alone"
    );
  }
  if (!template.includes(FILE)) throw new Error("gates.test_one must contain {file}");
  if (NOT_ONE_WORD.test(template)) {
    throw new Error(
      "gates.test_one must not contain a backtick, $(, <<, # or a newline: {file} must stay one shell word"
    );
  }
  if (placeholderIsQuoted(template)) {
    throw new Error("gates.test_one must not quote {file}: the engine quotes the path itself");
  }
  return fillShellTemplate(template, { [FILE]: path });
}
var isInside = (root, target) => {
  const rel = relative(root, target);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
var errorCode2 = (error) => error?.code;
var errorText = (error) => error instanceof Error ? error.message : String(error);
function fileProblem(abs, realRoot, path) {
  let stat;
  try {
    stat = lstatSync(abs);
  } catch (error) {
    const code = errorCode2(error);
    return code === "ENOENT" || code === "ENOTDIR" ? "does not exist" : `cannot be inspected (${code ?? errorText(error)})`;
  }
  if (stat.isSymbolicLink()) return "is a symbolic link, not a regular file";
  if (stat.isDirectory()) return "is a directory, not a regular file";
  if (!stat.isFile()) return "is not a regular file";
  try {
    const real = realpathSync(abs);
    if (!isInside(realRoot, real)) return "resolves outside the worktree";
    return real === join(realRoot, path) ? null : "is reached through a symbolic link, so git does not hold it under this path";
  } catch (error) {
    return `cannot be inspected (${errorCode2(error) ?? errorText(error)})`;
  }
}
var NOT_RUN_CODES = /* @__PURE__ */ new Set([124, 126, 127]);
var TIMED_OUT = /timed out after/i;
var NO_TEST_FOUND = /\bno tests? (suites? |files? )?found\b/i;
var NO_TEST_IN_SUITE = /\byour test suite must contain at least one test\b/i;
var COULD_NOT_FIND = /^Could not find '(.*)'$/;
function nodeFoundNothing(output, namesCandidate) {
  return output.split("\n").some((line) => {
    const quoted = COULD_NOT_FIND.exec(line)?.[1];
    return quoted !== void 0 && namesCandidate(quoted);
  });
}
var ANSI = (
  // eslint-disable-next-line no-control-regex -- the escape character is exactly what is stripped
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|[\]PX^_][^\u0007\u001b\n]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g
);
var FILE_COUNTS = [
  /^[ \t]*Test Files\b.*\((\d+)\)[ \t\r]*$/gm,
  /^[ \t]*Test Suites:.*?\b(\d+) total\b/gm
];
function reportedFileCount(output) {
  let largest = null;
  for (const line of FILE_COUNTS) {
    for (const match of output.matchAll(line)) {
      const n = Number(match[1]);
      if (largest === null || n > largest) largest = n;
    }
  }
  return largest;
}
function redProblem(result, namesCandidate) {
  const { code } = result;
  const output = typeof result.output === "string" ? result.output.replace(ANSI, "") : "";
  if (code === 0) return "passes before implementation, so it proves nothing";
  if (!Number.isInteger(code) || code < 0 || NOT_RUN_CODES.has(code) || TIMED_OUT.test(output)) {
    return `test command did not run (exit ${String(code)})`;
  }
  const files = reportedFileCount(output);
  if (files !== null && files !== 1) return `the runner ran ${files} test files, not just this one`;
  return NO_TEST_FOUND.test(output) || NO_TEST_IN_SUITE.test(output) || nodeFoundNothing(output, namesCandidate) ? "the runner found no test in it" : null;
}
function compilePattern(source) {
  if (typeof source !== "string" || source === "") {
    throw new Error("testPathPattern must be a non-empty regular expression");
  }
  try {
    return new RegExp(source);
  } catch (error) {
    throw new Error(`testPathPattern is not a valid regular expression (${errorText(error)})`, {
      cause: error
    });
  }
}
var MAX_BUFFER2 = 64 * 1024 * 1024;
function listFiles(worktree) {
  const env = hardenedGitEnv();
  let out;
  try {
    out = execFileSync(
      "git",
      [...HARDENED_GIT_OPTIONS, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: worktree, env, maxBuffer: MAX_BUFFER2, stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (error) {
    throw new Error(`cannot list the worktree's files (${errorText(error)})`, { cause: error });
  }
  return out.toString("latin1").split("\0").filter(Boolean).map((raw) => {
    const path = Buffer.from(raw, "latin1").toString("utf8");
    return { path, exact: Buffer.from(path, "utf8").toString("latin1") === raw };
  });
}
var fold = (s) => s.normalize("NFC").toLowerCase();
function gitWouldRewrite(worktree, path) {
  const run2 = (...args) => spawnSync("git", [...HARDENED_GIT_OPTIONS, "hash-object", ...args, "--", path], {
    cwd: worktree,
    env: hardenedGitEnv(),
    maxBuffer: MAX_BUFFER2,
    encoding: "utf8"
  });
  const filtered = run2(`--path=${path}`);
  const raw = run2("--no-filters");
  if (filtered.error || raw.error || filtered.status !== 0 || raw.status !== 0) return true;
  if (/^(error|fatal):/m.test(`${filtered.stderr}${raw.stderr}`)) return true;
  return filtered.stdout.trim() !== raw.stdout.trim();
}
var BUILTIN_TEST_SHAPES = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)__tests__\//
];
var runnerExcludes = (path) => path.split("/").some((segment) => segment === ".git" || segment === "node_modules");
function walkTestFiles(worktree, realRoot, isTest) {
  const siblings = [];
  const outside = [];
  const pending = [{ rel: "", real: realRoot, chain: [realRoot] }];
  for (let next = pending.pop(); next !== void 0; next = pending.pop()) {
    const { rel, real, chain } = next;
    let entries;
    try {
      entries = readdirSync(join(worktree, rel), { withFileTypes: true });
    } catch (error) {
      if (errorCode2(error) === "ENOENT") continue;
      return {
        siblings,
        outside,
        problem: `${errorCode2(error) ?? errorText(error)} reading ${rel === "" ? "." : rel}`
      };
    }
    for (const entry of entries) {
      if (rel === "" && (entry.name === ".git" || entry.name === "node_modules")) continue;
      const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
      let directory = entry.isDirectory();
      let childReal = join(real, entry.name);
      if (entry.isSymbolicLink()) {
        let target = null;
        try {
          if (statSync(join(worktree, path)).isDirectory())
            target = realpathSync(join(worktree, path));
        } catch {
          target = null;
        }
        if (target !== null) {
          if (target !== realRoot && !isInside(realRoot, target)) {
            outside.push({ path, runnerExcluded: runnerExcludes(path) });
            continue;
          }
          if (chain.includes(target)) continue;
          directory = true;
          childReal = target;
        }
      }
      if (directory) {
        pending.push({ rel: path, real: childReal, chain: [...chain, childReal] });
        continue;
      }
      if (!isTest.test(path) && !BUILTIN_TEST_SHAPES.some((shape) => shape.test(path))) continue;
      try {
        const { dev, ino } = lstatSync(join(worktree, path), { bigint: true });
        siblings.push({ path, dev, ino, runnerExcluded: runnerExcludes(path) });
      } catch (error) {
        if (errorCode2(error) !== "ENOENT") {
          return {
            siblings,
            outside,
            problem: `${errorCode2(error) ?? errorText(error)} reading ${path}`
          };
        }
      }
    }
  }
  return { siblings, outside, problem: null };
}
var escapeRegExp = (s) => s.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
function classEnd(glob, open) {
  let i = open + 1;
  if (glob[i] === "!" || glob[i] === "^") i += 1;
  if (glob[i] === "]") i += 1;
  return glob.indexOf("]", i);
}
var ANY = ".*";
function globElements(glob) {
  if (glob.includes("{")) return null;
  const out = [];
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if ("?*+@!".includes(ch) && glob[i + 1] === "(") return null;
    if (ch === "*") {
      while (glob[i + 1] === "*") i += 1;
      out.push(ANY);
    } else if (ch === "?") {
      out.push(".");
    } else if (ch === "[") {
      const end = classEnd(glob, i);
      if (end === -1) {
        out.push("\\[");
        continue;
      }
      const inner = glob.slice(i + 1, end);
      if (inner.includes("[:") || inner.includes("[.") || inner.includes("[=")) return null;
      const negated = inner.startsWith("!") || inner.startsWith("^");
      const members = (negated ? inner.slice(1) : inner).replace(/[\\\][^]/g, "\\$&");
      out.push(`[${negated ? "^" : ""}${members}]`);
      i = end;
    } else if (ch === "\\") {
      out.push(escapeRegExp(glob[i + 1] ?? "\\"));
      i += 1;
    } else {
      out.push(escapeRegExp(ch));
    }
  }
  return out;
}
function globMatcher(glob) {
  const elements = globElements(glob);
  if (elements === null) return null;
  try {
    return new RegExp(`^${elements.join("")}$`, "i");
  } catch {
    return null;
  }
}
function globCanEnter(glob, dir) {
  const elements = globElements(glob);
  if (elements === null) return true;
  const star = elements.indexOf(ANY);
  const head = star === -1 ? elements : elements.slice(0, star + 1);
  try {
    const prefix = head.reduceRight((rest, element) => `(?:${element}${rest})?`, "");
    const begins = new RegExp(`^${prefix}$`, "i");
    return [dir, fold(dir)].some((subject) => begins.test(`${subject}/`));
  } catch {
    return true;
  }
}
function regexMatcher(source) {
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}
function selectedBy(candidate, roots) {
  const folded = fold(candidate);
  const regex = regexMatcher(candidate);
  const glob = globMatcher(candidate);
  return (sibling) => {
    const subjects = [sibling.path, ...roots.map((root) => `${root}/${sibling.path}`)];
    const viaGlob = glob === null || [sibling.path, fold(sibling.path)].some((subject) => glob.test(subject));
    if (sibling.runnerExcluded) return viaGlob;
    return viaGlob || regex === null || subjects.some(
      (subject) => subject.includes(candidate) || fold(subject).includes(folded) || regex.test(subject) || regex.test(fold(subject))
    );
  };
}
var REWRITE = "git would rewrite this file on commit (eol/filter attributes); write it in its committed form";
var shown = (path) => typeof path === "string" ? JSON.stringify(path) : String(path);
var MAX_PATH = 1024;
var SHOWN_PREFIX = 64;
var FULL_SHA2 = /^[0-9a-f]{40}$/;
function placeCopy(root, path, bytes) {
  const parts = path.split("/");
  let current = root;
  for (let i = 0; i < parts.length; i += 1) {
    current = join(current, parts[i]);
    const where = parts.slice(0, i + 1).join("/");
    const last = i === parts.length - 1;
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (errorCode2(error) !== "ENOENT") {
        return `${where} cannot be inspected (${errorCode2(error) ?? errorText(error)})`;
      }
      if (last) break;
      try {
        mkdirSync(current);
      } catch (made) {
        return `${where} cannot be made (${errorCode2(made) ?? errorText(made)})`;
      }
      continue;
    }
    if (stat.isSymbolicLink()) return `${where} is a symbolic link`;
    if (!last && !stat.isDirectory()) return `${where} is not a directory`;
    if (last && !stat.isFile()) return `${where} is not a regular file`;
  }
  try {
    writeFileSync(current, bytes);
  } catch (error) {
    return `${path} cannot be written (${errorCode2(error) ?? errorText(error)})`;
  }
  return null;
}
function sealAuthoredTests(o) {
  const isTest = compilePattern(o.testPathPattern);
  formatTestOne(o.testOne, "probe.test.ts");
  if (!Number.isFinite(o.timeoutMs) || o.timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive finite number");
  }
  if (!isAbsolute(o.worktree)) throw new Error("worktree must be an absolute path");
  const { base } = o;
  if (base !== void 0) {
    if (typeof base.sha !== "string" || !FULL_SHA2.test(base.sha)) {
      throw new Error("base.sha must be the 40-hex SHA of the run's base commit");
    }
    if (typeof base.gitDir !== "string" || !isAbsolute(base.gitDir)) {
      throw new Error("base.gitDir must be an absolute path");
    }
  }
  const realRoot = realpathSync(o.worktree);
  const worktree = { root: o.worktree, realRoot };
  const reasons = [];
  if (o.tests.length === 0) reasons.push("no tests were authored");
  let files;
  const isListed = (path, list2) => list2.some((f) => f.exact && f.path === path);
  const selection = (tree, path, walked2) => {
    if (walked2.problem !== null) {
      return `cannot tell what the single-test command may also select (${walked2.problem})`;
    }
    const self = lstatSync(join(tree.root, path), { bigint: true });
    const selects = selectedBy(path, [.../* @__PURE__ */ new Set([tree.root, tree.realRoot])]);
    const own = fold(path);
    const other = walked2.siblings.filter((s) => !(s.dev === self.dev && s.ino === self.ino && fold(s.path) === own)).filter(selects).map((s) => s.path).sort()[0];
    return other === void 0 ? null : `the single-test command may also select ${other}`;
  };
  const outsideLinks = (found, path) => {
    for (const link of found.outside) {
      if (link.runnerExcluded && !globCanEnter(path, link.path)) continue;
      const reason2 = `${link.path}: symlinked directory points outside the worktree`;
      if (!reasons.includes(reason2)) reasons.push(reason2);
    }
  };
  let walked;
  const seen = /* @__PURE__ */ new Set();
  const accepted = [];
  for (const t of o.tests) {
    const path = t?.path;
    if (!isCanonicalPath(path)) {
      reasons.push(`${shown(path)}: path must be a canonical repo-relative POSIX path`);
      continue;
    }
    if (path.length > MAX_PATH) {
      const prefix = [...path].slice(0, SHOWN_PREFIX).join("");
      reasons.push(`${prefix}\u2026: path is too long to check safely (${path.length} chars)`);
      continue;
    }
    if (seen.has(path)) {
      reasons.push(`${path}: listed more than once`);
      continue;
    }
    seen.add(path);
    if (path.split("/").some((segment) => segment.startsWith("-"))) {
      reasons.push(`${path}: a path segment starting with "-" would be read as a runner option`);
      continue;
    }
    if (!isTest.test(path)) {
      reasons.push(`${path}: not a test path`);
      continue;
    }
    const abs = join(o.worktree, path);
    const problem = fileProblem(abs, realRoot, path);
    if (problem !== null) {
      reasons.push(`${path}: ${problem}`);
      continue;
    }
    const criteria = t.criteria;
    if (!Array.isArray(criteria) || criteria.length === 0 || criteria.some((c) => typeof c !== "string" || c.trim() === "")) {
      reasons.push(`${path}: maps to no acceptance criterion`);
      continue;
    }
    files ??= listFiles(o.worktree);
    if (!isListed(path, files)) {
      reasons.push(`${path}: not listed by git under this exact spelling`);
      continue;
    }
    if (gitWouldRewrite(o.worktree, path)) {
      reasons.push(`${path}: ${REWRITE}`);
      continue;
    }
    if (base === void 0) {
      walked ??= walkTestFiles(o.worktree, realRoot, isTest);
      outsideLinks(walked, path);
      const selected = selection(worktree, path, walked);
      if (selected !== null) {
        reasons.push(`${path}: ${selected}`);
        continue;
      }
    }
    accepted.push({ path, abs, criteria: [...criteria] });
  }
  const candidates = [];
  for (const a of accepted) {
    try {
      const bytes = readFileSync(a.abs);
      candidates.push({ ...a, before: sha256Bytes(bytes), bytes });
    } catch (error) {
      reasons.push(`${a.path}: cannot be read (${errorText(error)})`);
    }
  }
  const verdict = (sealed) => reasons.length > 0 ? { ok: false, reasons, sealed: [] } : { ok: true, reasons: [], sealed };
  const changed = (path) => `${path}: changed while its red run executed, so what ran is not what is sealed`;
  const redRuns = (red) => {
    const copied = red !== worktree;
    const failed = /* @__PURE__ */ new Set();
    if (copied) {
      for (const c of candidates) {
        const problem = placeCopy(red.root, c.path, c.bytes);
        if (problem !== null) {
          failed.add(c.path);
          reasons.push(`${c.path}: cannot be placed in the base tree (${problem})`);
        }
      }
      const walkedBase = walkTestFiles(red.root, red.realRoot, isTest);
      for (const c of candidates) {
        if (failed.has(c.path)) continue;
        outsideLinks(walkedBase, c.path);
        const selected = selection(red, c.path, walkedBase);
        if (selected !== null) {
          failed.add(c.path);
          reasons.push(`${c.path}: ${selected}`);
        }
      }
    }
    for (const c of candidates) {
      if (failed.has(c.path)) continue;
      let problem;
      try {
        const namesCandidate = (quoted) => [red.root, red.realRoot].some((root) => resolve(root, quoted) === resolve(root, c.path));
        problem = redProblem(
          o.run(formatTestOne(o.testOne, c.path), red.root, o.timeoutMs),
          namesCandidate
        );
      } catch (error) {
        problem = `test command did not run (${errorText(error)})`;
      }
      if (problem !== null) {
        failed.add(c.path);
        reasons.push(`${c.path}: ${problem}`);
      }
    }
    const afterRuns = candidates.length > 0 ? listFiles(o.worktree) : [];
    const walkedAfter = candidates.length > 0 ? walkTestFiles(red.root, red.realRoot, isTest) : void 0;
    if (walkedAfter !== void 0) for (const c of candidates) outsideLinks(walkedAfter, c.path);
    const sealed = [];
    for (const c of candidates) {
      if (failed.has(c.path)) continue;
      const problem = fileProblem(c.abs, realRoot, c.path);
      if (problem !== null) {
        reasons.push(`${c.path}: after its red run, it ${problem}`);
        continue;
      }
      if (!isListed(c.path, afterRuns)) {
        reasons.push(`${c.path}: after the red runs, not listed by git under this exact spelling`);
        continue;
      }
      if (gitWouldRewrite(o.worktree, c.path)) {
        reasons.push(`${c.path}: after the red runs, ${REWRITE}`);
        continue;
      }
      const copy = join(red.root, c.path);
      const moved = copied ? fileProblem(copy, red.realRoot, c.path) : null;
      if (moved !== null) {
        reasons.push(`${c.path}: after its red run, its copy in the base tree ${moved}`);
        continue;
      }
      const selected = walkedAfter === void 0 ? null : selection(red, c.path, walkedAfter);
      if (selected !== null) {
        reasons.push(`${c.path}: after the red runs, ${selected}`);
        continue;
      }
      let after;
      try {
        if (copied && sha256File(copy) !== c.before) {
          reasons.push(changed(c.path));
          continue;
        }
        after = sha256File(c.abs);
      } catch (error) {
        reasons.push(`${c.path}: cannot be read (${errorText(error)})`);
        continue;
      }
      if (after !== c.before) {
        reasons.push(changed(c.path));
        continue;
      }
      sealed.push({ path: c.path, criteria: c.criteria, sha256: after });
    }
    return verdict(sealed);
  };
  if (base === void 0) return redRuns(worktree);
  if (candidates.length === 0) return verdict([]);
  try {
    return withBaseWorktree(
      { worktree: o.worktree, gitDir: base.gitDir, commit: base.sha },
      (root) => redRuns({ root, realRoot: realpathSync(root) })
    );
  } catch (error) {
    if (!(error instanceof BaseTreeError)) throw error;
    reasons.push(`cannot prepare the base tree: ${error.message}`);
    return verdict([]);
  }
}
function writeSealManifest(runDir, sealed) {
  const paths = sealed.map((s) => s.path);
  for (const path of paths) {
    if (!isCanonicalPath(path)) throw new Error(`sealed path is not canonical: ${shown(path)}`);
  }
  const target = join(runDir, "sealed.json");
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(paths)}
`);
  renameSync(tmp, target);
}

// src/pipeline/learning.ts
var CHECKS_PATH = ".marvin/pipeline/checks.yaml";
var CALIBRATION_PATH = ".marvin/pipeline/calibration.jsonl";
var MEMORY_DIR = ".marvin/memory";
var MEMORY_INDEX_PATH = `${MEMORY_DIR}/MEMORY.md`;
function rankLessons(lessons, o) {
  const terms = new Set(
    o.paths.flatMap((p) => p.toLowerCase().split(/[/._()-]+/)).filter((t) => t.length > 3)
  );
  const score = (l) => {
    const hay = `${l.title} ${l.tags.join(" ")} ${l.body}`.toLowerCase();
    let s = [...terms].filter((t) => hay.includes(t)).length;
    if (o.paths.some((p) => l.body.includes(p))) s += 5;
    if (s > 0 && l.tags.includes(`role:${o.role}`)) s += 3;
    return s;
  };
  return lessons.map((l) => ({ l, s: score(l) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, o.limit).map((x) => x.l);
}
var lessonsMarkdown = (ls) => ls.length ? ls.map((l) => `- ${l.title} \u2014 .marvin/memory/${l.id}.md`).join("\n") : "(none)";
function aggregate(run2, events) {
  const prints = run2.rejections.flatMap((r) => r.fingerprints);
  const answers2 = events.filter((e) => e.kind === "answer");
  const perRole = /* @__PURE__ */ new Map();
  for (const c of run2.children) {
    const cur = perRole.get(c.role) ?? { costUsd: 0, cacheReadTokens: 0 };
    perRole.set(c.role, {
      costUsd: cur.costUsd + (c.costUsd ?? 0),
      cacheReadTokens: cur.cacheReadTokens + (c.cacheReadTokens ?? 0)
    });
  }
  return {
    tier: run2.tier,
    tierReasons: run2.tierReasons,
    iterations: run2.iteration,
    rung: run2.rung,
    rejections: run2.rejections,
    findingCategories: [...new Set(prints.map((p) => p.split("|")[0] ?? "").filter(Boolean))],
    repeatedFingerprints: [...new Set(prints.filter((p, i) => prints.indexOf(p) !== i))],
    questions: {
      byOrchestrator: answers2.filter((e) => e.data?.answeredBy === "orchestrator").length,
      byUser: answers2.filter((e) => e.data?.answeredBy === "user").length
    },
    perRole: [...perRole.entries()].map(([role, v]) => ({ role, ...v })),
    halted: run2.haltReason,
    assumptions: run2.assumptions
  };
}
function calibrationRecord(run2, agg, exposedLessons) {
  return {
    ts: run2.updatedAt,
    runId: run2.id,
    tier: run2.tier,
    stageA: run2.stageA,
    signalsReasons: run2.tierReasons,
    aggregate: agg,
    findingCategories: agg.findingCategories,
    exposedLessons: [...exposedLessons]
  };
}
var MIN_RECORDS = 5;
function efficacy(records, items) {
  const ordered = [...records].sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
  return items.map((it) => {
    const before = ordered.filter((r) => r.ts < it.createdAt).slice(-10);
    const after = ordered.filter(
      (r) => r.ts >= it.createdAt && (it.kind === "check" || r.exposedLessons.includes(it.id))
    );
    const rate = (rs) => rs.length ? rs.filter((r) => r.findingCategories.includes(it.targetCategory)).length / rs.length : 0;
    const verdict = before.length < MIN_RECORDS || after.length < MIN_RECORDS ? "too-early" : rate(after) >= rate(before) ? "prune-candidate" : "keep";
    return { id: it.id, exposure: after.length, before: rate(before), after: rate(after), verdict };
  });
}
var MAX_PATTERN_LENGTH = 500;
var CHECK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
var CATEGORY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
var ONE_LINE = /^[^\r\n]+$/;
function quantifierAt(source, i) {
  const ch = source[i];
  let length;
  let repeats;
  if (ch === "*" || ch === "+" || ch === "?") {
    length = 1;
    repeats = ch !== "?";
  } else if (ch === "{") {
    const braces = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i, i + 32));
    if (!braces) return null;
    length = braces[0].length;
    repeats = braces[2] === void 0 ? Number(braces[1]) > 1 : braces[3] === "" || Number(braces[3]) > 1;
  } else {
    return null;
  }
  return { length: source[i + length] === "?" ? length + 1 : length, repeats };
}
function staticRegexHazard(source) {
  const stack = [{ quantified: false, alternation: false }];
  let i = 0;
  while (i < source.length) {
    const top = stack[stack.length - 1];
    const ch = source[i];
    if (ch === "\\") {
      const next = source[i + 1];
      if (next !== void 0 && (/[1-9]/.test(next) || next === "k" && source[i + 2] === "<")) {
        return "it holds a backreference";
      }
      i += 2;
    } else if (ch === "[") {
      i += 1;
      while (i < source.length && source[i] !== "]") i += source[i] === "\\" ? 2 : 1;
      i += 1;
    } else if (ch === "(") {
      stack.push({ quantified: false, alternation: false });
      i += 1;
      if (source[i] === "?") {
        i += 1;
        const kind = source[i];
        if (kind === ":" || kind === "=" || kind === "!") {
          i += 1;
        } else if (kind === "<") {
          i += 1;
          if (source[i] === "=" || source[i] === "!") i += 1;
          else i = source.indexOf(">", i) + 1 || source.length;
        }
      }
    } else if (ch === ")") {
      const group = stack.length > 1 ? stack.pop() : top;
      const parent = stack[stack.length - 1];
      i += 1;
      const quantifier = quantifierAt(source, i);
      if (quantifier) {
        if (quantifier.repeats && group.quantified) {
          return "it has a nested quantifier: a repeated group that already holds a quantifier";
        }
        if (quantifier.repeats && group.alternation) {
          return "it repeats a group that holds an alternation";
        }
        i += quantifier.length;
      }
      parent.quantified ||= group.quantified || quantifier !== null;
      parent.alternation ||= group.alternation;
    } else if (ch === "|") {
      top.alternation = true;
      i += 1;
    } else {
      const quantifier = quantifierAt(source, i);
      if (quantifier) top.quantified = true;
      i += quantifier ? quantifier.length : 1;
    }
  }
  return null;
}
function regexHazard(source) {
  return staticRegexHazard(source);
}
var regexSource = external_exports.string().min(1).max(MAX_PATTERN_LENGTH).superRefine((value, ctx) => {
  try {
    new RegExp(value);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: `not a valid regular expression: ${why}`
    });
    return;
  }
  const hazard = regexHazard(value);
  if (hazard !== null) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: `unsafe regular expression: ${hazard}`
    });
  }
});
var oneLine = external_exports.string().trim().min(1).max(200).regex(ONE_LINE, "must be a single line");
var text = external_exports.string().trim().min(1);
var RETRO_CAPS = { checks: 10, proposals: 20, lessons: 10, prune: 50 };
var MAX_LESSON_BODY = 4e3;
var RESERVED_LESSON_SLUG = "memory";
var lessonTitle = oneLine.refine((title) => !/[[\]]/.test(title), "must not hold a square bracket").refine(
  (title) => slugify(title) !== RESERVED_LESSON_SLUG,
  `must not slug to "${RESERVED_LESSON_SLUG}", the name of the lesson index`
);
var lessonTag = external_exports.string().trim().min(1).max(64).regex(/^[^,\r\n]+$/, "must not hold a comma or a line break").refine((tag) => !/^target:/i.test(tag), "must not be a target: tag, the engine adds that one");
var RetroSchema = external_exports.object({
  checks: external_exports.array(
    external_exports.object({
      id: external_exports.string().regex(CHECK_ID, `must match ${CHECK_ID}`),
      pattern: regexSource,
      path_pattern: regexSource.optional(),
      exclude_pattern: regexSource.optional(),
      message: text,
      severity: external_exports.enum(SEVERITIES).optional(),
      category: external_exports.string().regex(CATEGORY, `must match ${CATEGORY}`).optional(),
      evidence: external_exports.array(external_exports.string()).optional()
    })
  ).max(RETRO_CAPS.checks),
  proposals: external_exports.array(
    external_exports.object({
      target: external_exports.enum(["marvin", "project"]),
      file: oneLine,
      change: text,
      rationale: text,
      evidence: external_exports.array(external_exports.string())
    })
  ).max(RETRO_CAPS.proposals),
  lessons: external_exports.array(
    external_exports.object({
      type: external_exports.enum(LESSON_TYPES),
      title: lessonTitle,
      body: text.pipe(external_exports.string().max(MAX_LESSON_BODY)),
      tags: external_exports.array(lessonTag),
      target_category: external_exports.string().regex(CATEGORY, `must match ${CATEGORY}`),
      evidence: external_exports.array(external_exports.string())
    })
  ).max(RETRO_CAPS.lessons),
  prune: external_exports.array(external_exports.object({ id: oneLine, reason: text })).max(RETRO_CAPS.prune)
});
var NO_RETRO = { checks: [], proposals: [], lessons: [], prune: [] };
function parseRetro(raw) {
  if (typeof raw === "object" && raw !== null) {
    for (const [key, cap] of Object.entries(RETRO_CAPS)) {
      const list2 = raw[key];
      if (Array.isArray(list2) && list2.length > cap) {
        throw new Error(
          `retro output rejected: ${key}: at most ${cap} allowed, got ${list2.length}`
        );
      }
    }
  }
  const parsed = RetroSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`retro output rejected: ${issues.join("; ")}`);
}
function physicalProblem(root, rel) {
  const parts = rel.split("/");
  let current = root;
  for (const [i, part] of parts.entries()) {
    current = join(current, part);
    const where = parts.slice(0, i + 1).join("/");
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      const code = error.code;
      return code === "ENOENT" ? null : `${where} cannot be inspected (${code ?? String(error)})`;
    }
    if (stat.isSymbolicLink()) return `${where} is a symbolic link`;
    if (i < parts.length - 1 && !stat.isDirectory()) return `${where} is not a directory`;
  }
  return null;
}
function assertPlain(root, rel) {
  const problem = physicalProblem(root, rel);
  if (problem !== null) throw new Error(`refusing to use ${rel} under ${root}: ${problem}`);
}
function removePlain(root, rel) {
  assertPlain(root, rel);
  rmSync(join(root, rel), { force: true });
}
function assertNotHardLinked(root, rel) {
  let stat;
  try {
    stat = lstatSync(join(root, rel));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (stat.isFile() && stat.nlink > 1) {
    throw new Error(`refusing to use ${rel} under ${root}: it is a hard link to another file`);
  }
}
function assertMemoryStore(root) {
  assertPlain(root, MEMORY_DIR);
  const dir = join(root, MEMORY_DIR);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const stat = lstatSync(join(dir, name));
    if (stat.isSymbolicLink()) {
      throw new Error(`refusing to use ${MEMORY_DIR}/${name}: it is a symbolic link`);
    }
  }
  assertNotHardLinked(root, MEMORY_INDEX_PATH);
}
function ensureDir(root, rel) {
  assertPlain(root, rel);
  mkdirSync(join(root, rel), { recursive: true });
}
function writeWhole(root, rel, content) {
  assertPlain(root, rel);
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    writeFileSync(tmp, content, { flag: "wx" });
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}
var ExistingChecks = external_exports.array(external_exports.object({ id: external_exports.string() }).passthrough());
function parseExistingChecks(text2, where) {
  if (text2 === null) return [];
  let doc;
  try {
    doc = (0, import_yaml3.parse)(text2);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`${where} is not valid YAML: ${why}`, { cause: error });
  }
  if (doc === null || doc === void 0) return [];
  const rules = ExistingChecks.safeParse(doc);
  if (!rules.success)
    throw new Error(`${where} must be a YAML list of rules, each with a string id`);
  return rules.data;
}
function mergeChecks(existing, retro) {
  const ids = new Set(existing.map((c) => c.id));
  const fresh = [];
  for (const { evidence: _evidence, ...rule } of retro.checks) {
    if (ids.has(rule.id)) continue;
    ids.add(rule.id);
    fresh.push(rule);
  }
  if (!fresh.length) return null;
  const text2 = (0, import_yaml3.stringify)([...existing, ...fresh], { lineWidth: 0 });
  return { text: text2, rules: (0, import_yaml3.parse)(text2) };
}
var proposalText = (n, p) => `# Proposal ${n} (${p.target})

- File: ${p.file}
- Change: ${p.change}
- Rationale: ${p.rationale}
- Evidence: ${p.evidence.join(", ")}
`;
var DUPLICATES_NOTE = "proposals/duplicate-lessons.md";
function assertRunDirTargets(runDir, retro) {
  assertPlain(runDir, "proposals");
  retro.proposals.forEach((p, i) => assertPlain(runDir, `proposals/${i + 1}-${p.target}.md`));
  assertPlain(runDir, "proposals/prune.md");
  assertPlain(runDir, DUPLICATES_NOTE);
}
function writeRunDirFiles(runDir, retro) {
  ensureDir(runDir, "proposals");
  retro.proposals.forEach(
    (p, i) => writeWhole(runDir, `proposals/${i + 1}-${p.target}.md`, proposalText(i + 1, p))
  );
  if (retro.prune.length) {
    writeWhole(
      runDir,
      "proposals/prune.md",
      `${retro.prune.map((p) => `- ${p.id}: ${p.reason}`).join("\n")}
`
    );
  }
}
function addLessons(root, runDir, lessons, sink) {
  const written = [];
  const duplicates = [];
  for (const lesson of lessons) {
    const result = sink(root, lesson);
    if (typeof result !== "object" || result === null) continue;
    if ("duplicateOf" in result) duplicates.push({ title: lesson.title, of: result.duplicateOf });
    else written.push(...result.added);
  }
  if (duplicates.length) {
    writeWhole(
      runDir,
      DUPLICATES_NOTE,
      `# Lessons skipped as near-duplicates

${duplicates.map((d) => `- ${d.title} (near-duplicate of ${d.of})`).join("\n")}
`
    );
  }
  return { written, duplicates };
}
var DELIVERY_HEADING = /^## Delivery[ \t]*$/;
var SECTION_HEADING = /^#{1,2}[ \t]/;
var FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
var STATUS_KEY = /^status[ \t]*:/;
function proseLines(lines, from) {
  const prose = lines.map(() => false);
  let fence = null;
  for (let i = from; i < lines.length; i += 1) {
    const m = FENCE.exec(lines[i]);
    if (fence === null) {
      const opens = m && !(m[1][0] === "`" && m[2].includes("`"));
      if (opens) fence = { char: m[1][0], length: m[1].length };
      else prose[i] = true;
    } else if (m && m[1][0] === fence.char && m[1].length >= fence.length && m[2].trim() === "") {
      fence = null;
    }
  }
  return prose;
}
function finalizeSpec(specText, d) {
  if (/[\r\n]/.test(d.pr) || /[\r\n]/.test(d.runId)) {
    throw new Error("the delivery's PR and run id must not contain a line break");
  }
  const lines = specText.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") throw new Error("spec has no front matter: it must start with ---");
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error("spec front matter is not closed by a --- line");
  let flipped = false;
  for (let i = 1; i < end; i += 1) {
    if (STATUS_KEY.test(lines[i])) {
      lines[i] = "status: shipped";
      flipped = true;
    }
  }
  if (!flipped) throw new Error("spec front matter has no status line");
  const prose = proseLines(lines, end + 1);
  const out = [];
  let cursor = 0;
  let insertAt = -1;
  for (let i = end + 1; i < lines.length; i += 1) {
    if (!prose[i] || !DELIVERY_HEADING.test(lines[i])) continue;
    let next = i + 1;
    while (next < lines.length && !(prose[next] && SECTION_HEADING.test(lines[next]))) next += 1;
    out.push(...lines.slice(cursor, i));
    if (insertAt === -1) insertAt = out.length;
    cursor = next;
    i = next - 1;
  }
  out.push(...lines.slice(cursor));
  if (insertAt === -1) insertAt = out.length;
  const head = out.slice(0, insertAt).join("\n").trimEnd();
  const tail = out.slice(insertAt).join("\n").replace(/^\s*\n/, "").trimEnd();
  const section = `## Delivery

- PR: ${d.pr}
- Pipeline run: ${d.runId} (${d.iterations} iterations)
`;
  return `${head}

${section}${tail ? `
${tail}
` : ""}`;
}
function calibrationText(existing, record) {
  const line = JSON.stringify(record);
  const isThisRun = (candidate) => {
    try {
      return JSON.parse(candidate).runId === record.runId;
    } catch {
      return false;
    }
  };
  const lines = existing === null ? [] : existing.split("\n").filter(Boolean);
  const next = lines.some(isThisRun) ? lines.map((candidate) => isThisRun(candidate) ? line : candidate) : [...lines, line];
  return `${next.join("\n")}
`;
}
var jsonLines = (text2) => text2.split("\n").filter(Boolean).map((line) => {
  try {
    return JSON.parse(line);
  } catch {
    return line;
  }
});
var targetTag = (category) => `target:${category}`;
function lessonStoreSink(source) {
  return (root, lesson) => {
    assertMemoryStore(root);
    const memoryDir = join(root, MEMORY_DIR);
    const duplicate = findNearDuplicate(memoryDir, lesson.title);
    if (duplicate) return { duplicateOf: duplicate.slug };
    const tags = [.../* @__PURE__ */ new Set([...lesson.tags, targetTag(lesson.target_category)])];
    const { slug } = addLesson(memoryDir, {
      type: lesson.type,
      title: lesson.title,
      body: lesson.body,
      tags,
      source
    });
    return { added: [`${MEMORY_DIR}/${slug}.md`, MEMORY_INDEX_PATH] };
  };
}
var FORMAT_TIMEOUT_MS = 5 * 60 * 1e3;
var COMMIT_TRAILER = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
var PLAIN_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
var FULL_SHA3 = /^[0-9a-f]{40}$/;
var FINALIZE_RECORD = "finalize-commit.json";
var specSlug = (frontmatterSlug, specPath) => [frontmatterSlug, basename(specPath, ".md").replace(/^\d+-/, ""), "spec"].find(
  (candidate) => candidate !== void 0 && PLAIN_TOKEN.test(candidate)
);
var outputTail = (output) => output.trimEnd().split("\n").slice(-20).join("\n").slice(-2e3);
function treeEntries(git4, commit, rel, recursive) {
  const out = git4.text(
    "ls-tree",
    ...recursive ? ["-r"] : [],
    "-z",
    "--full-tree",
    commit,
    "--",
    rel
  );
  return out.split("\0").filter(Boolean).map((record) => {
    const m = /^(\d+) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
    if (!m) throw new Error(`cannot read git ls-tree output: ${JSON.stringify(record)}`);
    return { mode: m[1], type: m[2], oid: m[3], path: m[4] };
  });
}
function blobOf(git4, commit, entry) {
  if (entry.type !== "blob" || entry.mode !== "100644" && entry.mode !== "100755") {
    throw new Error(`refusing to use ${entry.path}: it is not a regular file in ${commit}`);
  }
  return git4.bytes("cat-file", "blob", entry.oid);
}
function committedFile(git4, commit, rel) {
  const entry = treeEntries(git4, commit, rel, false).find((e) => e.path === rel);
  return entry === void 0 ? null : blobOf(git4, commit, entry);
}
function assertCommittedTargets(git4, targets) {
  const hidden = git4.text("ls-files", "-v", "-z", "--", ...targets).split("\0").filter(Boolean).filter((record) => record[0] !== record[0].toUpperCase() || record[0] === "S");
  if (hidden.length) {
    throw new Error(
      `refusing to finalize: an index flag hides changes under ${targets.join(", ")}: ${hidden.map((r) => r.slice(2)).join(", ")}`
    );
  }
  const dirty = git4.text("status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored", "--", ...targets).split("\0").filter(Boolean);
  if (dirty.length) {
    throw new Error(
      `refusing to finalize: uncommitted, untracked or ignored content under ${targets.join(", ")}: ${dirty.slice(0, 5).map((r) => r.slice(3)).join(", ")}`
    );
  }
}
function isOwnFinalizeCommit(git4, runDir, headSha, expectedHead) {
  try {
    assertPlain(runDir, FINALIZE_RECORD);
    const record = JSON.parse(readFileSync(join(runDir, FINALIZE_RECORD), "utf8"));
    return record.expectedHead === expectedHead && record.commit === headSha && git4.text("rev-parse", "--verify", `${headSha}^`).trim() === expectedHead;
  } catch {
    return false;
  }
}
function verifyContents(contents, expected, who) {
  const checks = contents.get(CHECKS_PATH);
  if (expected.rules !== void 0 && checks !== void 0) {
    let rules;
    try {
      rules = (0, import_yaml3.parse)(checks.toString("utf8"));
    } catch {
      rules = void 0;
    }
    if (!isDeepStrictEqual(rules, expected.rules)) {
      throw new Error(
        `${who} changed the rules in ${CHECKS_PATH}: a formatter may change layout, not rules`
      );
    }
  }
  const calibration = contents.get(CALIBRATION_PATH);
  if (calibration !== void 0 && !isDeepStrictEqual(jsonLines(calibration.toString("utf8")), expected.records)) {
    throw new Error(
      `${who} changed the records in ${CALIBRATION_PATH}: a formatter may change layout, not records`
    );
  }
}
function readFormatted(worktree, paths, expected) {
  const contents = /* @__PURE__ */ new Map();
  for (const rel of paths) {
    assertPlain(worktree, rel);
    assertNotHardLinked(worktree, rel);
    let stat;
    try {
      stat = lstatSync(join(worktree, rel));
    } catch {
      throw new Error(`the format command removed ${rel}`);
    }
    if (!stat.isFile()) throw new Error(`the format command left ${rel} as something but a file`);
    contents.set(rel, readFileSync(join(worktree, rel)));
  }
  verifyContents(contents, expected, "the format command");
  return contents;
}
var nulList = (text2) => text2.split("\0").filter(Boolean);
function finalizeRun(o) {
  const { run: run2 } = o;
  if (!PLAIN_TOKEN.test(run2.id))
    throw new Error(`run id is not a plain token: ${JSON.stringify(run2.id)}`);
  const retro = o.retro === null ? NO_RETRO : parseRetro(o.retro);
  const record = calibrationRecord(run2, aggregate(run2, o.events), o.exposedLessons);
  if (run2.prUrl === null || run2.haltReason !== null) {
    assertRunDirTargets(o.runDir, retro);
    assertPlain(o.runDir, "retro-output.json");
    assertPlain(o.runDir, "calibration.json");
    writeRunDirFiles(o.runDir, retro);
    writeWhole(o.runDir, "retro-output.json", `${JSON.stringify(retro, null, 2)}
`);
    writeWhole(o.runDir, "calibration.json", `${JSON.stringify(record, null, 2)}
`);
    return { shipped: false, commit: null, pushed: false, written: [] };
  }
  const { branch, specPath } = run2;
  const { worktree } = o;
  if (branch === null || !isSafeBranchRef(branch)) {
    throw new Error(`run branch is not a safe ref: ${String(branch)}`);
  }
  if (specPath === null || !isCanonicalPath(specPath)) {
    throw new Error(`run spec path is not a canonical repo-relative path: ${String(specPath)}`);
  }
  if (!isAbsolute(worktree) || !isAbsolute(o.gitDir)) {
    throw new Error("worktree and gitDir must be absolute paths");
  }
  if (typeof o.expectedHead !== "string" || !FULL_SHA3.test(o.expectedHead)) {
    throw new Error("expectedHead must be the 40-hex SHA of the commit the last gate approved");
  }
  const abs = (rel) => join(worktree, rel);
  const targets = [specPath, CHECKS_PATH, CALIBRATION_PATH, MEMORY_INDEX_PATH];
  for (const rel of targets) assertPlain(worktree, rel);
  assertPlain(worktree, MEMORY_DIR);
  assertRunDirTargets(o.runDir, retro);
  assertPlain(o.runDir, FINALIZE_RECORD);
  for (const rel of targets) assertNotHardLinked(worktree, rel);
  const git4 = isolatedGit(worktree, o.gitDir, { HUSKY: "0" });
  const headSha = git4.text("rev-parse", "--verify", "HEAD^{commit}").trim();
  if (headSha !== o.expectedHead && !isOwnFinalizeCommit(git4, o.runDir, headSha, o.expectedHead)) {
    throw new Error(`HEAD is ${headSha}, not the gated commit ${o.expectedHead}`);
  }
  let onBranch;
  try {
    onBranch = git4.text("symbolic-ref", "--short", "HEAD").trim();
  } catch {
    throw new Error(`the worktree is on no branch, and finalize pushes the run branch ${branch}`);
  }
  if (onBranch !== branch) {
    throw new Error(`the worktree is on branch ${onBranch}, not the run branch ${branch}`);
  }
  assertCommittedTargets(git4, [specPath, ".marvin/pipeline", MEMORY_DIR]);
  const specBase = committedFile(git4, headSha, specPath);
  if (specBase === null) throw new Error(`spec ${specPath} is not committed at ${headSha}`);
  const specText = specBase.toString("utf8");
  const shipped = finalizeSpec(specText, {
    pr: run2.prUrl,
    iterations: run2.iteration,
    runId: run2.id
  });
  const slug = specSlug(parseFrontmatter(specText).frontmatter.slug, specPath);
  const checksBase = committedFile(git4, headSha, CHECKS_PATH)?.toString("utf8") ?? null;
  const merged = mergeChecks(parseExistingChecks(checksBase, CHECKS_PATH), retro);
  const calibrationBase = committedFile(git4, headSha, CALIBRATION_PATH)?.toString("utf8") ?? null;
  const calibration = calibrationText(calibrationBase, record);
  const expected = { rules: merged?.rules, records: jsonLines(calibration) };
  const written = /* @__PURE__ */ new Set();
  const restoreFromCommit = (rel) => {
    const base = committedFile(git4, headSha, rel);
    if (base === null) removePlain(worktree, rel);
    else writeWhole(worktree, rel, base);
  };
  const scratch = mkdtempSync(join(tmpdir(), "marvin-finalize-"));
  const branchRef = `refs/heads/${branch}`;
  let newCommit = null;
  try {
    const memoryBase = /* @__PURE__ */ new Map();
    for (const entry of treeEntries(git4, headSha, MEMORY_DIR, true)) {
      const content = blobOf(git4, headSha, entry);
      memoryBase.set(entry.path, content);
      mkdirSync(dirname(join(scratch, entry.path)), { recursive: true });
      writeFileSync(join(scratch, entry.path), content);
    }
    const sink = o.addLesson ?? lessonStoreSink(`pipeline:${run2.id}`);
    writeRunDirFiles(o.runDir, retro);
    addLessons(scratch, o.runDir, retro.lessons, sink);
    const memoryChanges = [];
    const memoryDir = join(scratch, MEMORY_DIR);
    const memoryFiles = existsSync(memoryDir) ? readdirSync(memoryDir, { withFileTypes: true }) : [];
    for (const entry of memoryFiles.filter((e) => e.isFile())) {
      const rel = `${MEMORY_DIR}/${entry.name}`;
      const content = readFileSync(join(scratch, rel));
      if (!memoryBase.get(rel)?.equals(content)) memoryChanges.push([rel, content]);
    }
    const writes = [
      ...merged ? [[CHECKS_PATH, merged.text]] : [],
      [CALIBRATION_PATH, calibration],
      [specPath, shipped],
      ...memoryChanges
    ];
    for (const [rel, content] of writes) {
      written.add(rel);
      writeWhole(worktree, rel, content);
    }
    const paths = [...written];
    if (o.formatCommand?.trim()) {
      const command = `${o.formatCommand} ${paths.map((rel) => shellQuote(abs(rel))).join(" ")}`;
      const result = (o.runCommand ?? shellRunner)(command, worktree, FORMAT_TIMEOUT_MS);
      if (result.code !== 0) {
        throw new Error(
          `format_command failed (exit ${result.code}): ${outputTail(result.output)}`
        );
      }
    }
    const headNow = git4.text("rev-parse", "--verify", "HEAD^{commit}").trim();
    if (headNow !== headSha) {
      throw new Error(
        `HEAD moved from ${headSha} to ${headNow} while finalize ran: the format command must not commit`
      );
    }
    const branchNow = git4.text("symbolic-ref", "--short", "HEAD").trim();
    if (branchNow !== branch) {
      throw new Error(
        `the worktree moved to branch ${branchNow} while finalize ran, not ${branch}`
      );
    }
    const contents = readFormatted(worktree, paths, expected);
    const plumbing = isolatedGit(worktree, o.gitDir, {
      HUSKY: "0",
      GIT_INDEX_FILE: join(scratch, "index")
    });
    plumbing.text("read-tree", headSha);
    const changed = [];
    let indexInfo = "";
    for (const [rel, bytes] of contents) {
      const oid = git4.textIn(bytes, "hash-object", "-w", "--no-filters", "--stdin").trim();
      const committedEntry = treeEntries(git4, headSha, rel, false).find((e) => e.path === rel);
      if (committedEntry?.oid === oid) continue;
      changed.push(rel);
      indexInfo += `${committedEntry?.mode ?? "100644"} ${oid}	${rel}\0`;
    }
    if (changed.length > 0) {
      plumbing.textIn(indexInfo, "update-index", "-z", "--index-info");
      const tree = plumbing.text("write-tree").trim();
      const subject = `chore(${slug}): ship spec; lessons and calibration from run ${run2.id}`;
      newCommit = git4.text("commit-tree", tree, "-p", headSha, "-m", subject, "-m", COMMIT_TRAILER).trim();
      git4.text("update-ref", branchRef, newCommit, headSha);
      git4.text("reset", "-q", "--", ...changed);
      const parents = git4.text("rev-list", "--parents", "-n", "1", newCommit).trim().split(" ");
      if (git4.text("rev-parse", "--verify", "HEAD^{commit}").trim() !== newCommit || parents.length !== 2 || parents[1] !== headSha) {
        throw new Error(
          `the finalize commit ${newCommit} is not the one HEAD names, on top of ${headSha}`
        );
      }
      const listed = nulList(
        git4.text("diff-tree", "-r", "--name-only", "--no-renames", "-z", headSha, newCommit)
      ).sort();
      if (!isDeepStrictEqual(listed, [...changed].sort())) {
        throw new Error(
          `the finalize commit changes ${listed.join(", ")}, not only ${[...changed].join(", ")}`
        );
      }
      const committedContents = /* @__PURE__ */ new Map();
      for (const [rel, bytes] of contents) {
        const blob = committedFile(git4, newCommit, rel);
        if (blob === null || !blob.equals(bytes)) {
          throw new Error(`${rel} in the finalize commit is not what finalize wrote`);
        }
        committedContents.set(rel, blob);
      }
      verifyContents(committedContents, expected, "the finalize commit");
    }
  } catch (error) {
    try {
      const current = git4.text("rev-parse", "--verify", branchRef).trim();
      if (current !== headSha) git4.text("update-ref", branchRef, headSha, current);
    } catch {
    }
    for (const rel of written) {
      try {
        restoreFromCommit(rel);
      } catch {
      }
    }
    try {
      git4.text("reset", "-q", "--", ...written);
    } catch {
    }
    throw error;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (newCommit !== null) {
    writeWhole(
      o.runDir,
      FINALIZE_RECORD,
      `${JSON.stringify({ expectedHead: o.expectedHead, commit: newCommit })}
`
    );
  }
  try {
    git4.text("push", "origin", `${newCommit ?? headSha}:${branchRef}`);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new Error(`push of ${branch} failed; the finalize commit stays in the worktree: ${why}`, {
      cause: error
    });
  }
  return { shipped: true, commit: newCommit, pushed: true, written: [...written] };
}

// src/pipeline/engine.ts
var PR_URL_PATTERN = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
var SpecPath = external_exports.string().refine((path) => isCanonicalPath(path) && path.endsWith(".md"), {
  message: "must be a canonical repo-relative path ending in .md"
});
var Question = external_exports.object({
  id: external_exports.string().min(1),
  text: external_exports.string(),
  recommendation: external_exports.string(),
  why_blocking: external_exports.string()
}).passthrough();
var FindingShape = external_exports.object({
  id: external_exports.string().min(1),
  severity: external_exports.enum(SEVERITIES),
  category: external_exports.string().min(1),
  file: external_exports.string().optional(),
  line: external_exports.number().int().optional(),
  criterion: external_exports.string().optional(),
  claim: external_exports.string(),
  evidence: external_exports.string(),
  expected: external_exports.string()
});
var PlannerOutput = external_exports.object({
  status: external_exports.enum(["needs_input", "spec_ready"]),
  summary: external_exports.string(),
  questions: external_exports.array(Question).default([]),
  spec: external_exports.object({ path: SpecPath }).passthrough().optional(),
  assumptions: external_exports.array(external_exports.string()).default([])
}).superRefine((out, ctx) => {
  if (out.status === "needs_input" && out.questions.length === 0) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["questions"],
      message: "needs_input requires at least one question"
    });
  }
  if (out.status === "spec_ready" && out.spec === void 0) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["spec"],
      message: "spec_ready requires a spec"
    });
  }
  if (out.status === "spec_ready" && out.questions.length > 0) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["questions"],
      message: "spec_ready must not carry questions"
    });
  }
});
var TestAuthorOutput = external_exports.object({
  status: external_exports.literal("done"),
  tests: external_exports.array(external_exports.object({ path: external_exports.string(), criteria: external_exports.array(external_exports.string()) }))
});
var ExecutorOutput = external_exports.object({
  status: external_exports.enum(["done", "needs_input"]),
  claims: external_exports.array(external_exports.string()).default([]),
  questions: external_exports.array(Question).default([]),
  dispute: external_exports.object({ path: external_exports.string(), reason: external_exports.string(), evidence: external_exports.string() }).passthrough().optional(),
  pr_url: external_exports.string().regex(PR_URL_PATTERN, "must be a github.com pull request URL").optional()
}).superRefine((out, ctx) => {
  if (out.status === "needs_input" && out.questions.length === 0 && !out.dispute) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["questions"],
      message: "needs_input requires a question or a dispute"
    });
  }
  if (out.status === "done" && out.questions.length > 0) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["questions"],
      message: "done must not carry questions"
    });
  }
  if (out.status === "done" && out.dispute) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["dispute"],
      message: "done must not carry a dispute"
    });
  }
});
var VerifierOutput = external_exports.object({
  status: external_exports.literal("done"),
  verdict: external_exports.enum(["PASS", "FAIL"]),
  criteria: external_exports.array(
    external_exports.object({
      id: external_exports.string().min(1),
      result: external_exports.enum(["met", "unmet", "unverifiable"]),
      evidence: external_exports.string()
    })
  ).min(1),
  findings: external_exports.array(FindingShape)
});
var RetroOutput = external_exports.object({ status: external_exports.literal("done") }).passthrough().superRefine((out, ctx) => {
  try {
    parseRetro(out);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message });
  }
});
function parseOutput(schema, result) {
  const parsed = schema.safeParse(result.structured);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { issue: `${first?.path.join(".") || "(root)"}: ${first?.message ?? "invalid"}` };
  }
  if (parsed.data.status !== result.outcome) {
    return {
      issue: `status: "${parsed.data.status}" does not match the reported outcome "${result.outcome}"`
    };
  }
  return { data: parsed.data };
}
function readOutput(role, result, run2) {
  switch (role) {
    case "planner": {
      const r = parseOutput(PlannerOutput, result);
      return "issue" in r ? r : { role, data: r.data };
    }
    case "test-author": {
      const r = parseOutput(TestAuthorOutput, result);
      return "issue" in r ? r : { role, data: r.data };
    }
    case "executor": {
      const r = parseOutput(ExecutorOutput, result);
      if ("issue" in r) return r;
      if (r.data.status === "done" && !r.data.pr_url && run2.prUrl === null) {
        return { issue: "pr_url: done without a pull request, and the run has none" };
      }
      return { role, data: r.data };
    }
    case "verifier": {
      const r = parseOutput(VerifierOutput, result);
      return "issue" in r ? r : { role, data: r.data };
    }
    case "retro": {
      const r = parseOutput(RetroOutput, result);
      return "issue" in r ? r : { role, data: r.data };
    }
  }
}
var SpawnRecord = external_exports.object({
  kind: external_exports.literal("spawn"),
  role: external_exports.enum(ROLES),
  assignment: Assignment,
  iteration: external_exports.number().int().min(0),
  context: external_exports.record(external_exports.string(), external_exports.string()),
  resume: external_exports.boolean()
});
function lastSpawnOf(run2, role) {
  const parsed = SpawnRecord.safeParse(run2.lastSpawn[role]);
  if (!parsed.success || parsed.data.role !== role) {
    throw new Error(`no previous spawn for ${role}`);
  }
  return parsed.data;
}
var STAGE_OF = {
  planner: "planning",
  "test-author": "test_authoring",
  executor: "executing",
  verifier: "verifying",
  retro: "retro"
};
var CHILD_FAULTS = /* @__PURE__ */ new Set(["crashed", "failed", "limited", "stalled"]);
var blocking = (f) => f.severity !== "minor";
var asFindings = (xs) => xs;
var asRecords = (fs) => fs;
var unique = (xs) => [...new Set(xs)];
var notReady = (prUrl) => `PR not marked ready: ${prUrl}`;
var UNSPECIFIED_CLAIM = {
  gate: "gate failed without a blocking finding",
  verifier: "verifier rejected without a blocking finding",
  ci: "CI failed without a named failing job"
};
var unspecified = (source) => ({
  id: `${source}-unspecified`,
  severity: "blocker",
  category: "gate",
  criterion: `unspecified-${source}`,
  claim: UNSPECIFIED_CLAIM[source],
  evidence: `the ${source} verdict is a rejection and names no blocking finding`,
  expected: `the ${source} names what failed`
});
function mergeSealed(old, fresh) {
  const byPath = new Map(old.map((s) => [s.path, s]));
  for (const s of fresh) byPath.set(s.path, s);
  return [...byPath.values()];
}
function findingsText(fs) {
  if (!fs.length) return "(none)";
  return fs.map(
    (f) => `- [${f.id}] ${f.severity}/${f.category}${f.file ? ` ${f.file}${f.line ? `:${f.line}` : ""}` : ""}: ${f.claim} \u2014 expected: ${f.expected}
  evidence: ${f.evidence}`
  ).join("\n");
}
function decide(run2, obs, rubric, now) {
  const decision = step(run2, obs, rubric, now);
  const spawns = decision.actions.filter((a) => a.kind === "spawn");
  if (spawns.length === 0) return decision;
  const lastSpawn = { ...decision.run.lastSpawn };
  for (const s of spawns) lastSpawn[s.role] = { ...structuredClone(s) };
  return { run: { ...decision.run, lastSpawn }, actions: decision.actions };
}
function step(run2, obs, rubric, now) {
  const go = (r, to, reason2) => {
    const next = transition(r, to, now, reason2);
    return to === "ci_wait" || to === "finalizing" ? next : { ...next, ciSince: null };
  };
  const startClock = (r) => ({ ...r, ciSince: now.toISOString() });
  const ask = (r, judgment, payload) => ({
    run: r,
    actions: [{ kind: "judgment", judgment, payload }]
  });
  const spawn3 = (r, role, context, resume2 = false) => {
    const tier = r.tier ?? r.stageA;
    const own = assignmentFor(tier, role, role === "executor" ? r.rung : 0, rubric);
    if (own === "skip") throw new Error(`${role} is skipped on tier ${tier}`);
    const assignment = role === "verifier" ? enforceVerifierFloor(assignmentFor(tier, "executor", r.rung, rubric), own) : own;
    return { kind: "spawn", role, assignment, iteration: r.iteration, context, resume: resume2 };
  };
  const sealedList = (r) => r.sealed.map((s) => `- ${s.path} (${s.criteria.join(", ")})`).join("\n") || "(none)";
  const executorCtx = (r, fs) => ({
    // The run id and tier go into the PR body's Pipeline section, written by pr-create.
    run: r.id,
    tier: r.tier ?? r.stageA,
    iteration: String(r.iteration),
    branch: r.branch ?? "",
    spec: r.specPath ?? "",
    base: r.base,
    sealed: sealedList(r),
    findings: findingsText(fs)
  });
  const verifierCtx = (r) => ({
    iteration: String(r.iteration),
    branch: r.branch ?? "",
    pr: r.prUrl ?? "(none)",
    spec: r.specPath ?? "",
    base: r.base,
    gate_report: JSON.stringify(r.gateReport ?? {}, null, 2),
    sealed: sealedList(r),
    previous: findingsText(asFindings(r.previousFindings)),
    claims: r.claims.map((c) => `- ${c}`).join("\n") || "(none)"
  });
  const testAuthorCtx = (r, feedback) => ({
    spec: r.specPath ?? "",
    feedback: feedback || "(first attempt)"
  });
  const cancel2 = (r, reason2) => {
    if (r.stage === "ready" || r.stage === "done" || r.stage === "halted") {
      throw new Error(`no rule for stage ${r.stage} and cancel`);
    }
    if (r.stage === "finalizing") {
      const closed = { ...go(r, "done"), haltReason: r.haltReason ?? reason2 };
      const pr = r.prUrl ? `; ${notReady(r.prUrl)}` : "";
      return { run: closed, actions: [{ kind: "notify", text: `halted: ${reason2}${pr}` }] };
    }
    if (r.stage === "retro") {
      const fin = go({ ...r, haltReason: r.haltReason ?? reason2 }, "finalizing");
      return { run: fin, actions: [{ kind: "work", work: "finalize", data: { retro: null } }] };
    }
    const retro = go(go({ ...r, awaitingRole: null }, "halted", reason2), "retro");
    return {
      run: retro,
      actions: [spawn3(retro, "retro", {}), { kind: "notify", text: `halted: ${reason2}` }]
    };
  };
  const pollCi = (r) => {
    const started = r.ciSince === null ? Number.NaN : Date.parse(r.ciSince);
    if (Number.isNaN(started)) {
      return { run: startClock(r), actions: [{ kind: "work", work: "ci" }] };
    }
    const waited = now.getTime() - started;
    if (waited > rubric.caps.ci_wait_minutes * 6e4) {
      return ask(r, "no_ci", {
        reason: `CI still pending after ${Math.floor(waited / 6e4)} min`
      });
    }
    return { run: r, actions: [{ kind: "work", work: "ci" }] };
  };
  const toRetro = (r) => {
    const retro = go(r, "retro");
    return {
      run: retro,
      actions: [spawn3(retro, "retro", {}), { kind: "notify", text: "CI green; retro started" }]
    };
  };
  const reopenTests = (r, feedback, reason2, detail2, findings) => {
    const counted = {
      ...r,
      testAuthorAttempts: r.testAuthorAttempts + 1,
      ...findings ? { previousFindings: asRecords(findings) } : {}
    };
    const reopened = r.stage === "test_authoring" ? counted : go({ ...counted, awaitingRole: null }, "test_authoring");
    const action = spawn3(reopened, "test-author", testAuthorCtx(reopened, feedback));
    if (counted.testAuthorAttempts >= rubric.caps.test_author_attempts) {
      return ask(
        {
          ...counted,
          haltRole: "test-author",
          lastSpawn: { ...counted.lastSpawn, "test-author": { ...action } }
        },
        "halt",
        { reason: reason2, detail: detail2 }
      );
    }
    return { run: reopened, actions: [action] };
  };
  const reject = (r, source, found) => {
    const fs = found.length ? found : [unspecified(source)];
    const prints = fs.map(fingerprint);
    const last = r.rejections.at(-1)?.fingerprints ?? [];
    let rung = r.rung + 1;
    if (prints.some((p) => last.includes(p))) {
      while (rubric.escalation[rung - 1]?.startsWith("effort")) rung += 1;
    }
    const next = {
      ...r,
      rung,
      previousFindings: asRecords(fs),
      rejections: [...r.rejections, { iteration: r.iteration, source, fingerprints: prints }]
    };
    const halted = (reason2) => ask({ ...next, haltRole: "executor" }, "halt", { reason: reason2, findings: fs });
    const stepNow = rubric.escalation[rung - 1];
    if (next.rejections.length >= rubric.caps.rejections || stepNow === void 0 || stepNow === "halt") {
      return halted(`rejected ${next.rejections.length} times (last: ${source})`);
    }
    const exec = go({ ...next, iteration: r.iteration + 1 }, "executing");
    try {
      return {
        run: exec,
        actions: [
          spawn3(exec, "executor", executorCtx(exec, fs)),
          {
            kind: "notify",
            text: `${source} rejected iteration ${r.iteration} (${fs.length} blocking); executor ${exec.iteration} started on rung ${rung}`
          }
        ]
      };
    } catch (error) {
      if (error instanceof HaltError) return halted(error.message);
      throw error;
    }
  };
  const retryHalt = (r) => {
    const role = r.haltRole;
    const cleared = {
      ...r,
      retries: Object.fromEntries(Object.entries(r.retries).filter(([name]) => name !== role)),
      haltRole: null
    };
    if (role === null) {
      if (r.stage === "ci_wait" || r.stage === "finalizing") {
        return { run: startClock(cleared), actions: [{ kind: "work", work: "ci" }] };
      }
      throw new Error(`nothing to retry in stage ${r.stage}`);
    }
    if (r.stage === STAGE_OF[role]) return { run: cleared, actions: [lastSpawnOf(r, role)] };
    if (role === "executor") {
      const halt = rubric.escalation.indexOf("halt");
      const usable = halt === -1 ? rubric.escalation.length : halt;
      const exec = go(
        { ...cleared, iteration: r.iteration + 1, rung: Math.min(r.rung, usable) },
        "executing"
      );
      return {
        run: exec,
        actions: [spawn3(exec, "executor", executorCtx(exec, asFindings(r.previousFindings)))]
      };
    }
    if (role === "test-author") {
      const reopened = go({ ...cleared, awaitingRole: null }, "test_authoring");
      return { run: reopened, actions: [lastSpawnOf(r, role)] };
    }
    throw new Error(`cannot retry ${role} from stage ${r.stage}`);
  };
  const child = obs.kind === "child" ? obs : null;
  let output = null;
  if (child) {
    const { role, result } = child;
    if (result.outcome === "running") throw new Error(`${role} is still running`);
    if (child.leaked?.length) {
      return ask({ ...run2, haltRole: role }, "halt", {
        reason: `${role} wrote outside its worktree`,
        detail: child.leaked
      });
    }
    if (child.mutated?.length) {
      return ask({ ...run2, haltRole: role }, "halt", {
        reason: `${role} mutated the tree`,
        detail: child.mutated
      });
    }
    if (STAGE_OF[role] !== run2.stage) {
      throw new Error(`no rule for stage ${run2.stage} and ${role} result`);
    }
    let fault = null;
    if (CHILD_FAULTS.has(result.outcome)) {
      fault = { kind: result.outcome, reason: `${role} ${result.outcome}`, detail: result.detail };
    } else {
      const read = readOutput(role, result, run2);
      if ("issue" in read) {
        fault = {
          kind: "invalid",
          reason: `${role} returned invalid output (${read.issue})`,
          detail: read.issue
        };
      } else output = read;
    }
    if (fault) {
      const tries = run2.retries[role] ?? 0;
      const spent = tries >= rubric.caps.child_retries;
      if (role === "retro" && (spent || fault.kind === "limited")) {
        return {
          run: go(run2, "finalizing"),
          actions: [{ kind: "work", work: "finalize", data: { retro: null } }]
        };
      }
      if (fault.kind === "limited" || fault.kind === "stalled" || spent) {
        return ask({ ...run2, haltRole: role }, "halt", {
          reason: fault.reason,
          detail: fault.detail
        });
      }
      return {
        run: { ...run2, retries: { ...run2.retries, [role]: tries + 1 } },
        actions: [lastSpawnOf(run2, role)]
      };
    }
  }
  if (obs.kind === "answer" && obs.judgment === "halt") {
    if (obs.answer.kind === "cancel") return cancel2(run2, obs.answer.reason);
    if (obs.answer.kind !== "retry") {
      throw new Error(`a halt cannot be answered with ${obs.answer.kind}`);
    }
    return retryHalt(run2);
  }
  switch (run2.stage) {
    case "intake":
      if (obs.kind === "start") {
        const r = go(run2, "planning");
        return {
          run: r,
          actions: [
            spawn3(r, "planner", { task: r.task.english, critic_cap: String(criticCap(r, rubric)) })
          ]
        };
      }
      break;
    case "planning": {
      if (output?.role !== "planner") break;
      const out = output.data;
      if (out.status === "needs_input") {
        const cap = rubric.caps.planner_questions;
        if (run2.questionsAnswered + out.questions.length > cap) {
          if (run2.questionsAnswered > cap) {
            return ask({ ...run2, haltRole: "planner" }, "halt", {
              reason: "planner kept asking past the question cap",
              detail: out.questions
            });
          }
          const lines = out.questions.map(
            (q) => `${q.id}: ${q.recommendation} (recommendation accepted: question cap reached)`
          );
          const r2 = {
            ...run2,
            questionsAnswered: run2.questionsAnswered + out.questions.length,
            assumptions: unique([...run2.assumptions, ...lines])
          };
          return {
            run: r2,
            actions: [spawn3(r2, "planner", { message: `ANSWERS:
${lines.join("\n")}` }, true)]
          };
        }
        return ask(
          go({ ...run2, awaitingRole: "planner" }, "awaiting_answer"),
          "planner_questions",
          { questions: out.questions }
        );
      }
      if (!child?.signals) throw new Error("spec_ready observation carries no signals");
      const { tier, reasons } = tierFor(child.signals, rubric);
      const assumptions = unique([...run2.assumptions, ...out.assumptions]);
      const r = go(
        { ...run2, specPath: out.spec?.path ?? null, tier, tierReasons: reasons, assumptions },
        "awaiting_approval"
      );
      return ask(r, "spec_approval", {
        spec: out.spec,
        summary: out.summary,
        tier,
        reasons,
        assumptions,
        assignments: previewAssignments(r, rubric)
      });
    }
    case "awaiting_answer": {
      if (obs.kind !== "answer") break;
      const role = run2.awaitingRole ?? "planner";
      if (obs.judgment !== (role === "planner" ? "planner_questions" : "executor_questions")) break;
      const a = obs.answer;
      if (a.kind === "cancel") return cancel2(run2, a.reason);
      if (a.kind === "answers") {
        const r = go(
          { ...run2, awaitingRole: null, questionsAnswered: run2.questionsAnswered + a.count },
          role === "planner" ? "planning" : "executing"
        );
        return { run: r, actions: [spawn3(r, role, { message: `ANSWERS:
${a.text}` }, true)] };
      }
      if (a.kind === "revise_tests" && role === "executor") {
        return reopenTests(
          run2,
          a.text,
          "the sealed tests were revised too often",
          [a.text],
          [
            {
              id: "T-revise",
              severity: "major",
              category: "test-quality",
              claim: `the sealed tests were reopened at the orchestrator's request: ${a.text}`,
              evidence: "the orchestrator answered the executor's dispute with revise_tests",
              expected: "sealed tests that match the request"
            }
          ]
        );
      }
      break;
    }
    case "awaiting_approval": {
      if (obs.kind !== "answer" || obs.judgment !== "spec_approval") break;
      const a = obs.answer;
      if (a.kind === "cancel") return cancel2(run2, a.reason);
      if (a.kind === "changes") {
        const r = go(run2, "planning");
        return {
          run: r,
          actions: [spawn3(r, "planner", { message: `CHANGES REQUESTED:
${a.text}` }, true)]
        };
      }
      if (a.kind === "approve") {
        const tiered = a.tier ? {
          ...run2,
          tier: a.tier,
          tierReasons: [...run2.tierReasons, `override: ${a.reason ?? "orchestrator"}`]
        } : run2;
        const rename = { kind: "work", work: "rename_branch" };
        if (shouldAuthorTests(tiered, rubric)) {
          const r2 = go(tiered, "test_authoring");
          return { run: r2, actions: [rename, spawn3(r2, "test-author", testAuthorCtx(r2, ""))] };
        }
        const r = go({ ...tiered, iteration: 1 }, "executing");
        return { run: r, actions: [rename, spawn3(r, "executor", executorCtx(r, []))] };
      }
      break;
    }
    case "test_authoring": {
      if (output?.role === "test-author") {
        return {
          run: run2,
          actions: [{ kind: "work", work: "seal", data: { tests: output.data.tests } }]
        };
      }
      if (obs.kind === "seal") {
        if (obs.ok === true && obs.reasons.length === 0 && obs.sealed.length > 0) {
          const r = go(
            { ...run2, sealed: mergeSealed(run2.sealed, obs.sealed), iteration: run2.iteration + 1 },
            "executing"
          );
          return {
            run: r,
            actions: [spawn3(r, "executor", executorCtx(r, asFindings(run2.previousFindings)))]
          };
        }
        const reasons = obs.reasons.length ? obs.reasons : [obs.ok ? "seal reported success but sealed no tests" : "seal failed without a reason"];
        return reopenTests(run2, reasons.join("\n"), "acceptance tests rejected", reasons);
      }
      break;
    }
    case "executing": {
      if (output?.role !== "executor") break;
      const out = output.data;
      if (out.status === "needs_input") {
        const cap = rubric.caps.executor_questions;
        if (run2.executorQuestionRounds >= cap) {
          return ask({ ...run2, haltRole: "executor" }, "halt", {
            reason: `executor asked more than ${cap} times`,
            detail: { questions: out.questions, dispute: out.dispute ?? null }
          });
        }
        const asking = { ...run2, awaitingRole: "executor" };
        return ask(
          go(
            { ...asking, executorQuestionRounds: run2.executorQuestionRounds + 1 },
            "awaiting_answer"
          ),
          "executor_questions",
          {
            questions: out.questions,
            dispute: out.dispute ?? null
          }
        );
      }
      const r = go({ ...run2, claims: out.claims, prUrl: out.pr_url ?? run2.prUrl }, "gating");
      return { run: r, actions: [{ kind: "work", work: "gate" }] };
    }
    case "gating": {
      if (obs.kind !== "gate") break;
      const supplied = new Set(obs.findings.map((f) => f.id));
      const found = [
        ...obs.findings,
        ...reportFindings(obs.report).filter((f) => !supplied.has(f.id))
      ];
      const blockers = found.filter(blocking);
      if (obs.report.passed !== true || blockers.length > 0) return reject(run2, "gate", blockers);
      const minors = asRecords(found);
      const r = go(
        {
          ...run2,
          gateReport: obs.report,
          minorFindings: [...run2.minorFindings, ...minors]
        },
        "verifying"
      );
      return {
        run: r,
        actions: [{ kind: "work", work: "snapshot" }, spawn3(r, "verifier", verifierCtx(r))]
      };
    }
    case "verifying": {
      if (obs.kind === "answer") {
        if (obs.judgment !== "unverified") break;
        const a = obs.answer;
        if (a.kind === "cancel") return cancel2(run2, a.reason);
        if (a.kind === "proceed") {
          const reason2 = a.reason?.trim();
          if (!reason2) throw new Error("proceeding without verification evidence needs a reason");
          const assumptions = [
            ...run2.assumptions,
            `verification accepted without evidence: ${reason2}`
          ];
          return {
            run: startClock(go({ ...run2, assumptions: unique(assumptions) }, "ci_wait")),
            actions: [
              { kind: "work", work: "ci" },
              { kind: "notify", text: "verification accepted without evidence; waiting for CI" }
            ]
          };
        }
        if (a.kind === "retry") {
          const r2 = {
            ...run2,
            retries: { ...run2.retries, unverified: (run2.retries.unverified ?? 0) + 1 }
          };
          return {
            run: r2,
            actions: [{ kind: "work", work: "snapshot" }, spawn3(r2, "verifier", verifierCtx(r2))]
          };
        }
        break;
      }
      if (output?.role !== "verifier") break;
      const v = output.data;
      const unmet = v.criteria.filter((c) => c.result === "unmet").map((c) => ({
        id: `AC-${c.id}`,
        severity: "blocker",
        category: "criterion",
        criterion: c.id,
        claim: `criterion ${c.id} unmet`,
        evidence: c.evidence,
        expected: `criterion ${c.id} met`
      }));
      const unverifiable = v.criteria.filter((c) => c.result === "unverifiable").map((c) => ({
        id: `AC-${c.id}-unverifiable`,
        severity: "minor",
        category: "criterion",
        criterion: c.id,
        claim: `criterion ${c.id} could not be verified`,
        evidence: c.evidence,
        expected: "human check"
      }));
      const all = [...v.findings, ...unmet];
      const blockers = all.filter(blocking);
      const base = {
        ...run2,
        minorFindings: [
          ...run2.minorFindings,
          ...asRecords([...all.filter((f) => !blocking(f)), ...unverifiable])
        ]
      };
      const sealedPaths = new Set(run2.sealed.map((s) => s.path));
      const testFaults = blockers.filter(
        (f) => f.category === "test-quality" && f.file && sealedPaths.has(f.file)
      );
      if (testFaults.length && testFaults.length === blockers.length) {
        return reopenTests(
          base,
          findingsText(testFaults),
          "the verifier faulted the sealed tests",
          testFaults,
          testFaults
        );
      }
      if (blockers.length) return reject(base, "verifier", blockers);
      if (v.verdict !== "PASS") {
        const tries = run2.retries.verifier ?? 0;
        if (tries >= rubric.caps.child_retries) {
          return ask({ ...base, haltRole: "verifier" }, "halt", {
            reason: "verifier returned FAIL without blocking findings"
          });
        }
        const r2 = { ...base, retries: { ...base.retries, verifier: tries + 1 } };
        return {
          run: r2,
          actions: [{ kind: "work", work: "snapshot" }, spawn3(r2, "verifier", verifierCtx(r2))]
        };
      }
      const named = new Set(v.criteria.map((c) => c.id));
      const missing = unique(run2.sealed.flatMap((s) => s.criteria)).filter((id) => !named.has(id));
      if (!v.criteria.some((c) => c.result === "met") || missing.length > 0) {
        if ((run2.retries.unverified ?? 0) >= rubric.caps.child_retries) {
          return ask({ ...base, haltRole: "verifier" }, "halt", {
            reason: "verifier PASS verified nothing, again after a retry",
            detail: { criteria: v.criteria, missing }
          });
        }
        return ask(base, "unverified", { criteria: v.criteria, missing });
      }
      const r = startClock(go(base, "ci_wait"));
      return {
        run: r,
        actions: [
          { kind: "work", work: "ci" },
          { kind: "notify", text: `verifier PASS on iteration ${run2.iteration}` }
        ]
      };
    }
    case "ci_wait": {
      if (obs.kind === "answer") {
        if (obs.judgment !== "no_ci") break;
        const a = obs.answer;
        if (a.kind === "cancel") return cancel2(run2, a.reason);
        if (a.kind === "proceed") return toRetro(run2);
        if (a.kind === "wait") {
          return { run: startClock(run2), actions: [{ kind: "work", work: "ci" }] };
        }
        break;
      }
      if (obs.kind !== "ci") break;
      if (obs.state === "pending") return pollCi(run2);
      if (obs.state === "green" && obs.failing.length === 0) return toRetro(run2);
      if (obs.state === "no_ci") return ask(run2, "no_ci", {});
      if (obs.state === "closed")
        return ask({ ...run2, haltRole: null }, "halt", { reason: "PR was closed" });
      const fs = obs.state === "conflict" ? [
        {
          id: "CI-conflict",
          severity: "blocker",
          category: "gate",
          claim: `PR conflicts with ${run2.base}`,
          evidence: "mergeable=CONFLICTING",
          expected: `merge origin/${run2.base} into the branch (no rebase, no force-push) and resolve`
        }
      ] : obs.failing.map((name) => ({
        id: `CI-${name}`,
        severity: "blocker",
        category: "gate",
        file: name,
        claim: `CI job ${name} failed`,
        evidence: "see the PR checks",
        expected: `${name} green`
      }));
      return reject(run2, "ci", fs);
    }
    case "retro": {
      if (output?.role === "retro") {
        return {
          run: go(run2, "finalizing"),
          actions: [{ kind: "work", work: "finalize", data: { retro: child?.result.structured } }]
        };
      }
      break;
    }
    case "finalizing": {
      if (obs.kind === "answer") {
        if (obs.judgment !== "no_ci") break;
        const a = obs.answer;
        if (a.kind === "cancel") return cancel2(run2, a.reason);
        if (a.kind === "wait") {
          return { run: startClock(run2), actions: [{ kind: "work", work: "ci" }] };
        }
        if (a.kind === "proceed") {
          return {
            run: go(run2, "done"),
            actions: [
              { kind: "notify", text: "CI did not complete after finalize; PR left as draft" }
            ]
          };
        }
        break;
      }
      if (obs.kind === "finalized") {
        if (run2.haltReason) {
          const text2 = run2.prUrl ? `halted run closed; retro saved; ${notReady(run2.prUrl)}` : "halted run closed; retro saved";
          return { run: go(run2, "done"), actions: [{ kind: "notify", text: text2 }] };
        }
        return {
          run: startClock({ ...run2, finalized: true }),
          actions: [{ kind: "work", work: "ci" }]
        };
      }
      if (obs.kind === "ci") {
        if (obs.state === "pending") return pollCi(run2);
        if (obs.state === "green" && obs.failing.length === 0) {
          return {
            run: go(run2, "ready"),
            actions: [
              { kind: "work", work: "mark_ready" },
              { kind: "notify", text: "PR ready to merge" }
            ]
          };
        }
        return ask({ ...run2, haltRole: null }, "halt", {
          reason: obs.state === "green" ? "CI reports green but names failing jobs after finalize" : `CI ${obs.state} after finalize`,
          failing: obs.failing
        });
      }
      break;
    }
  }
  const detail = obs.kind === "answer" ? ` (${obs.judgment}: ${obs.answer.kind})` : "";
  throw new Error(`no rule for stage ${run2.stage} and observation ${obs.kind}${detail}`);
}

// src/pipeline/loop.ts
var JOURNAL = "engine.journal.json";
var JUDGMENTS = "judgments";
var LOCK = "engine.lock";
var CURSOR = "await.cursor";
var EVENTS = "events.jsonl";
var TERMINAL = /* @__PURE__ */ new Set(["ready", "done"]);
var tmpPath = (path) => join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
function writeAtomic(path, text2) {
  const tmp = tmpPath(path);
  writeFileSync(tmp, text2);
  renameSync(tmp, path);
}
function createExclusive(path, text2) {
  const tmp = tmpPath(path);
  writeFileSync(tmp, text2);
  try {
    linkSync(tmp, path);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  } finally {
    rmSync(tmp, { force: true });
  }
}
var errorText2 = (error) => error instanceof Error ? error.message : String(error);
var oneLine2 = (text2) => text2.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").trim();
function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
var Holder = external_exports.object({
  pid: external_exports.number().int(),
  token: external_exports.string(),
  startedAt: external_exports.string(),
  releasedAt: external_exports.string().nullable()
});
var GENERATION = /^(\d+)\.json$/;
var generationFile = (dir, generation) => join(dir, `${String(generation).padStart(6, "0")}.json`);
function generations(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((name) => GENERATION.exec(name)?.[1]).filter((n) => n !== void 0).map(Number).sort((a, b) => a - b);
}
function readHolder(dir, generation) {
  try {
    return Holder.parse(JSON.parse(readFileSync(generationFile(dir, generation), "utf8")));
  } catch {
    return null;
  }
}
function lockState(runDir) {
  const dir = join(runDir, LOCK);
  const generation = generations(dir).at(-1) ?? 0;
  const holder = generation > 0 ? readHolder(dir, generation) : null;
  const alive = holder !== null && holder.releasedAt === null && isAlive(holder.pid);
  return { generation, holder, alive };
}
function acquireLock(runDir, pid = process.pid) {
  const dir = join(runDir, LOCK);
  mkdirSync(dir, { recursive: true });
  const token = randomUUID();
  for (let round = 0; round < 32; round++) {
    const { generation, holder, alive } = lockState(runDir);
    if (alive) throw new Error(`engine already running (pid ${holder?.pid})`);
    const mine = generation + 1;
    const body = { pid, token, startedAt: (/* @__PURE__ */ new Date()).toISOString(), releasedAt: null };
    if (!createExclusive(generationFile(dir, mine), `${JSON.stringify(body)}
`)) continue;
    const listed = generations(dir);
    if (listed.at(-1) !== mine) {
      rmSync(generationFile(dir, mine), { force: true });
      continue;
    }
    for (const older of listed) {
      if (older < mine) rmSync(generationFile(dir, older), { force: true });
    }
    return () => releaseLock(dir, mine, token);
  }
  throw new Error(`could not take the engine lock in ${dir}: it kept changing`);
}
function releaseLock(dir, generation, token) {
  const holder = readHolder(dir, generation);
  if (!holder || holder.token !== token || holder.releasedAt !== null) return;
  const released = { ...holder, releasedAt: (/* @__PURE__ */ new Date()).toISOString() };
  writeAtomic(generationFile(dir, generation), `${JSON.stringify(released)}
`);
}
function lockHolderPid(runDir) {
  return lockState(runDir).holder?.pid ?? null;
}
function engineAlive(runDir) {
  return lockState(runDir).alive;
}
var Text = external_exports.string().trim().min(1);
var cancel = external_exports.object({ kind: external_exports.literal("cancel"), reason: Text }).strict();
var answers = external_exports.object({ kind: external_exports.literal("answers"), text: Text, count: external_exports.number().int().min(0) }).strict();
var reviseTests = external_exports.object({ kind: external_exports.literal("revise_tests"), text: Text }).strict();
var approve = external_exports.object({ kind: external_exports.literal("approve"), tier: external_exports.enum(TIERS).optional(), reason: Text.optional() }).strict();
var changes = external_exports.object({ kind: external_exports.literal("changes"), text: Text }).strict();
var retry = external_exports.object({ kind: external_exports.literal("retry") }).strict();
var wait = external_exports.object({ kind: external_exports.literal("wait") }).strict();
var proceed = external_exports.object({ kind: external_exports.literal("proceed"), reason: Text.optional() }).strict();
var proceedWithReason = external_exports.object({ kind: external_exports.literal("proceed"), reason: Text }).strict();
var AnswerSchemas = {
  planner_questions: external_exports.discriminatedUnion("kind", [answers, cancel]),
  executor_questions: external_exports.discriminatedUnion("kind", [answers, reviseTests, cancel]),
  spec_approval: external_exports.discriminatedUnion("kind", [approve, changes, cancel]),
  halt: external_exports.discriminatedUnion("kind", [retry, cancel]),
  no_ci: external_exports.discriminatedUnion("kind", [wait, proceed, cancel]),
  unverified: external_exports.discriminatedUnion("kind", [retry, proceedWithReason, cancel])
};
var JUDGMENT_KINDS = Object.keys(AnswerSchemas);
var schemaFor = (kind) => AnswerSchemas[kind];
var isKind = (kind) => JUDGMENT_KINDS.includes(kind);
var RequestFile = external_exports.object({
  id: external_exports.string(),
  kind: external_exports.string(),
  payload: external_exports.record(external_exports.string(), external_exports.unknown())
});
var ID = /^(\d{3,})-([a-z_]+)$/;
var REQUEST_FILE = /^(\d{3,})-([a-z_]+)\.request\.json$/;
var judgmentsDir = (runDir) => join(runDir, JUDGMENTS);
var requestPath = (runDir, id) => join(judgmentsDir(runDir), `${id}.request.json`);
var answerPath = (runDir, id) => join(judgmentsDir(runDir), `${id}.answer.json`);
var formatId = (seq, kind) => `${String(seq).padStart(3, "0")}-${kind}`;
function parseId(id) {
  const match = ID.exec(id);
  const kind = match?.[2];
  if (!match || !isKind(kind)) throw new Error(`not a judgment id: ${JSON.stringify(id)}`);
  return { seq: Number(match[1]), kind };
}
function requestIds(runDir) {
  if (!existsSync(judgmentsDir(runDir))) return [];
  return readdirSync(judgmentsDir(runDir)).map((name) => REQUEST_FILE.exec(name)).filter((m) => m !== null && isKind(m[2])).sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => `${m[1]}-${m[2]}`);
}
var nextSeq = (runDir) => Math.max(0, ...requestIds(runDir).map((id) => parseId(id).seq)) + 1;
function readRequest(runDir, id) {
  const { kind } = parseId(id);
  let raw;
  try {
    raw = readFileSync(requestPath(runDir, id), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(`no judgment ${id}`, { cause: error });
  }
  const request = RequestFile.parse(JSON.parse(raw));
  if (request.id !== id || request.kind !== kind) {
    throw new Error(`judgment file ${id} names ${request.id} (${request.kind})`);
  }
  return { id, kind, payload: request.payload };
}
function refusals(runDir, id) {
  if (!existsSync(judgmentsDir(runDir))) return 0;
  const prefix = `${id}.refused-`;
  return readdirSync(judgmentsDir(runDir)).filter((name) => name.startsWith(prefix)).length;
}
function requestJudgment(runDir, kind, payload, id = formatId(nextSeq(runDir), kind)) {
  if (parseId(id).kind !== kind) throw new Error(`judgment id ${id} is not a ${kind}`);
  mkdirSync(judgmentsDir(runDir), { recursive: true });
  createExclusive(requestPath(runDir, id), `${JSON.stringify({ id, kind, payload }, null, 2)}
`);
  return id;
}
function pendingJudgment(runDir) {
  const open = requestIds(runDir).find((id) => !existsSync(answerPath(runDir, id)));
  return open ? readRequest(runDir, open) : null;
}
function answerJudgment(runDir, id, raw, opts = {}) {
  const request = readRequest(runDir, id);
  if (existsSync(answerPath(runDir, id))) throw new Error(`judgment ${id} already answered`);
  const parsed = schemaFor(request.kind).safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".") || "(root)";
    throw new Error(`invalid answer to ${id} (${request.kind}): ${where}: ${first?.message}`);
  }
  const answer = parsed.data;
  const questions = request.payload.questions;
  if (answer.kind === "answers" && Array.isArray(questions)) {
    const least = questions.length > 0 ? 1 : 0;
    if (answer.count < least || answer.count > questions.length) {
      const asked = questions.length;
      throw new Error(
        `answer to ${id} counts ${answer.count} questions; the judgment asked ${asked}`
      );
    }
  }
  if (existsSync(join(runDir, "run.json"))) {
    const run2 = loadRun(runDir);
    if (run2.pendingJudgment && run2.pendingJudgment.id !== id) {
      throw new Error(`judgment ${run2.pendingJudgment.id} is pending, not ${id}`);
    }
    if (opts.rubric) {
      const obs = { kind: "answer", judgment: request.kind, answer };
      try {
        decide(run2, obs, opts.rubric, opts.now ?? /* @__PURE__ */ new Date());
      } catch (error) {
        throw new Error(`answer to ${id} refused: ${errorText2(error)}`, { cause: error });
      }
    }
  }
  if (!createExclusive(answerPath(runDir, id), `${JSON.stringify(answer)}
`)) {
    throw new Error(`judgment ${id} already answered`);
  }
  return answer;
}
function readAnswer(runDir, id) {
  const { kind } = parseId(id);
  let raw;
  try {
    raw = readFileSync(answerPath(runDir, id), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const parsed = schemaFor(kind).safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`the answer file of ${id} is not a valid ${kind} answer`);
  return parsed.data;
}
function refuseAnswer(runDir, id, reason2) {
  const aside = join(judgmentsDir(runDir), `${id}.refused-${refusals(runDir, id) + 1}.json`);
  renameSync(answerPath(runDir, id), aside);
  appendEvent(runDir, {
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    kind: "note",
    actor: "engine",
    text: `answer to ${id} refused: ${oneLine2(reason2)}`,
    data: { notify: true, id }
  });
}
var JournalFile = external_exports.object({
  version: external_exports.literal(1),
  run: Run,
  steps: external_exports.array(
    external_exports.union([
      external_exports.object({
        ref: external_exports.string().min(1),
        kind: external_exports.literal("event"),
        event: external_exports.object({
          ts: external_exports.string(),
          kind: EventKind,
          actor: external_exports.string(),
          text: external_exports.string(),
          data: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
        })
      }),
      external_exports.object({
        ref: external_exports.string().min(1),
        kind: external_exports.literal("action"),
        action: external_exports.object({ kind: external_exports.enum(["spawn", "judgment", "work"]) }).passthrough(),
        judgmentId: external_exports.string().optional()
      })
    ])
  ),
  next: external_exports.number().int().min(0),
  queue: external_exports.array(external_exports.object({ kind: external_exports.string() }).passthrough())
});
function persist(runDir, j) {
  const checked = { ...j, run: Run.parse(j.run) };
  writeAtomic(join(runDir, JOURNAL), `${JSON.stringify(checked)}
`);
  saveRun(runDir, checked.run);
  return checked;
}
var settle = (runDir) => rmSync(join(runDir, JOURNAL), { force: true });
function resume(runDir) {
  const file = join(runDir, JOURNAL);
  if (existsSync(file)) {
    let parsed;
    try {
      parsed = JournalFile.safeParse(JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      throw new Error(`the engine journal ${file} is unreadable: ${errorText2(error)}`, {
        cause: error
      });
    }
    if (!parsed.success) {
      throw new Error(
        `the engine journal ${file} is unreadable: ${parsed.error.issues[0]?.message}`
      );
    }
    const journal = parsed.data;
    saveRun(runDir, journal.run);
    return journal;
  }
  const run2 = loadRun(runDir);
  const idle = { version: 1, run: run2, steps: [], next: 0, queue: [] };
  if (!run2.pendingWork) return idle;
  const { work, data } = run2.pendingWork;
  const action = { kind: "work", work, ...data ? { data } : {} };
  return { ...idle, steps: [{ ref: randomUUID(), kind: "action", action }] };
}
function plan(runDir, before, d, queue, answered) {
  const ts = (/* @__PURE__ */ new Date()).toISOString();
  const steps = [];
  const event = (e) => steps.push({ ref: randomUUID(), kind: "event", event: e });
  if (answered) {
    const text2 = `${answered.id}: ${answered.answer.kind}`;
    event({ ts, kind: "answer", actor: "engine", text: text2, data: { id: answered.id } });
  }
  if (d.run.stage !== before.stage) {
    const text2 = `${before.stage} \u2192 ${d.run.stage}`;
    event({ ts, kind: "stage", actor: "engine", text: text2, data: { notify: true } });
  }
  let seq = nextSeq(runDir);
  for (const action of d.actions) {
    if (action.kind === "notify") {
      event({ ts, kind: "note", actor: "engine", text: action.text, data: { notify: true } });
    } else if (action.kind === "judgment") {
      const judgmentId = formatId(seq++, action.judgment);
      steps.push({ ref: randomUUID(), kind: "action", action, judgmentId });
    } else {
      steps.push({ ref: randomUUID(), kind: "action", action });
    }
  }
  return persist(runDir, { version: 1, run: d.run, steps, next: 0, queue });
}
function emit(runDir, ref, event, replay) {
  if (replay && readEventsFrom(runDir, 0).events.some((e) => e.data?.ref === ref)) return;
  appendEvent(runDir, { ...event, data: { ...event.data, ref } });
}
async function perform(runDir, j, deps, replay) {
  const step2 = j.steps[j.next];
  if (!step2) throw new Error(`no journal step ${j.next}`);
  const advance = (run2, queue = j.queue) => persist(runDir, { ...j, run: run2, next: j.next + 1, queue });
  if (step2.kind === "event") {
    emit(runDir, step2.ref, step2.event, replay);
    return advance(j.run);
  }
  const info = { ref: step2.ref, replay };
  const { action } = step2;
  switch (action.kind) {
    case "spawn":
      return advance(deps.spawnChild(j.run, action, info));
    case "judgment": {
      const id = requestJudgment(runDir, action.judgment, action.payload, step2.judgmentId);
      const ts = (/* @__PURE__ */ new Date()).toISOString();
      const asked = `judgment ${id}`;
      const event = { ts, kind: "question", actor: "engine", text: asked };
      emit(runDir, step2.ref, { ...event, data: { notify: true, id } }, replay);
      return advance({ ...j.run, pendingJudgment: { id, kind: action.judgment } });
    }
    case "work": {
      const pendingWork = action.data ? { work: action.work, data: action.data } : { work: action.work };
      const marked = persist(runDir, { ...j, run: { ...j.run, pendingWork } });
      const out = await deps.work(marked.run, action.work, action.data, info);
      const queue = out.obs ? [...j.queue, out.obs] : j.queue;
      return persist(runDir, {
        ...marked,
        run: { ...out.run, pendingWork: null },
        next: j.next + 1,
        queue
      });
    }
  }
}
var pollMsOf = (deps) => Number.isFinite(deps.pollMs) && deps.pollMs >= 1 ? deps.pollMs : 1;
function answerFromFixture(runDir, id, kind, deps) {
  const dir = deps.fixturesDir;
  if (deps.judge !== "fixtures" || !dir) return;
  for (const name of [`${id}.json`, `${kind}.json`]) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    answerJudgment(runDir, id, JSON.parse(readFileSync(file, "utf8")), { rubric: deps.rubric });
    return;
  }
}
async function awaitAnswer(runDir, id, kind, deps) {
  if (refusals(runDir, id) === 0 && !existsSync(answerPath(runDir, id))) {
    answerFromFixture(runDir, id, kind, deps);
  }
  for (; ; ) {
    try {
      const answer = readAnswer(runDir, id);
      if (answer) return answer;
    } catch (error) {
      refuseAnswer(runDir, id, errorText2(error));
    }
    await setTimeout(pollMsOf(deps), void 0, { signal: deps.signal });
  }
}
async function observe(runDir, run2, deps) {
  const pending = run2.pendingJudgment;
  if (pending) {
    const { kind } = parseId(pending.id);
    if (kind !== pending.kind) {
      throw new Error(`pending judgment ${pending.id} is not a ${pending.kind}`);
    }
    const answer = await awaitAnswer(runDir, pending.id, kind, deps);
    return {
      run: { ...run2, pendingJudgment: null },
      obs: { kind: "answer", judgment: kind, answer },
      answered: { id: pending.id, answer }
    };
  }
  let current = run2;
  while (current.children.some((c) => c.status === "running")) {
    const seen = await deps.waitChild(current, deps.signal);
    if (seen.obs.kind !== "child" || seen.obs.result.outcome !== "running") {
      return { ...seen, answered: null };
    }
    current = seen.run;
    saveRun(runDir, current);
    deps.signal?.throwIfAborted();
  }
  throw new Error(`engine has nothing to wait for in stage ${run2.stage}`);
}
async function drive(runDir, deps) {
  deps.signal?.throwIfAborted();
  let j = resume(runDir);
  let replay = j.next < j.steps.length;
  if (!replay && j.queue.length === 0 && j.run.stage === "intake") {
    const prepared = j.run.worktree === null ? await deps.prepare(j.run) : j.run;
    saveRun(runDir, prepared);
    const d = decide(prepared, { kind: "start" }, deps.rubric, /* @__PURE__ */ new Date());
    j = plan(runDir, prepared, d, [], null);
  }
  for (; ; ) {
    while (j.next < j.steps.length) {
      deps.signal?.throwIfAborted();
      j = await perform(runDir, j, deps, replay);
      replay = false;
    }
    if (TERMINAL.has(j.run.stage)) break;
    let before;
    let obs;
    let queue = [];
    let answered = null;
    const [queued, ...rest] = j.queue;
    if (queued) {
      before = j.run;
      obs = queued;
      queue = rest;
    } else {
      settle(runDir);
      deps.signal?.throwIfAborted();
      const seen = await observe(runDir, j.run, deps);
      before = seen.run;
      obs = seen.obs;
      answered = seen.answered;
    }
    let d;
    try {
      d = decide(before, obs, deps.rubric, /* @__PURE__ */ new Date());
    } catch (error) {
      if (!answered) throw error;
      refuseAnswer(runDir, answered.id, errorText2(error));
      continue;
    }
    j = plan(runDir, before, d, queue, answered);
  }
  settle(runDir);
  return j.run;
}
function noteStop(runDir, error, signal) {
  const requested = signal?.aborted === true;
  try {
    appendEvent(runDir, {
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      kind: "note",
      actor: "engine",
      text: requested ? "engine stopped on request" : `engine stopped: ${oneLine2(errorText2(error))}`,
      ...requested ? {} : { data: { notify: true } }
    });
  } catch {
  }
}
async function runEngine(runDir, deps) {
  if (deps.judge === "fixtures" && !deps.fixturesDir) {
    throw new Error("the fixtures judge needs a fixtures directory");
  }
  if (!existsSync(join(runDir, "run.json"))) throw new Error(`no run at ${runDir}`);
  const release = acquireLock(runDir);
  try {
    return await drive(runDir, deps);
  } catch (error) {
    noteStop(runDir, error, deps.signal);
    throw error;
  } finally {
    release();
  }
}
function readEventsFrom(runDir, cursor) {
  let fd;
  try {
    fd = openSync(join(runDir, EVENTS), "r");
  } catch (error) {
    if (error.code === "ENOENT") return { events: [], cursor: 0 };
    throw error;
  }
  try {
    const size = fstatSync(fd).size;
    const start2 = Number.isSafeInteger(cursor) && cursor >= 0 && cursor <= size ? cursor : 0;
    const buffer = Buffer.alloc(size - start2);
    let filled = 0;
    while (filled < buffer.length) {
      const read = readSync(fd, buffer, filled, buffer.length - filled, start2 + filled);
      if (read === 0) break;
      filled += read;
    }
    const end = buffer.subarray(0, filled).lastIndexOf(10);
    if (end < 0) return { events: [], cursor: start2 };
    const events = buffer.subarray(0, end).toString("utf8").split("\n").flatMap((line) => {
      try {
        const e = JSON.parse(line);
        return e && typeof e.kind === "string" && typeof e.text === "string" ? [e] : [];
      } catch {
        return [];
      }
    });
    return { events, cursor: start2 + end + 1 };
  } finally {
    closeSync(fd);
  }
}
var eventLines = (events) => events.filter((e) => e.data?.notify === true && EventKind.safeParse(e.kind).success).map((e) => `EVENT ${e.kind} ${oneLine2(e.text)}`);
function standing(runDir) {
  const out = [];
  const pending = pendingJudgment(runDir);
  if (pending) {
    out.push({
      key: `judgment ${pending.id} ${refusals(runDir, pending.id)}`,
      line: `JUDGMENT ${pending.id} ${pending.kind} ${requestPath(runDir, pending.id)}`,
      always: false
    });
  }
  const run2 = loadRun(runDir);
  const unfinished = existsSync(join(runDir, JOURNAL)) || run2.pendingWork !== null;
  const { stage } = run2;
  if (TERMINAL.has(stage) && !unfinished) {
    out.push({ key: `stage ${stage}`, line: `STAGE ${stage}`, always: true });
  } else {
    const lock = lockState(runDir);
    if (!lock.alive)
      out.push({ key: `down ${lock.generation}`, line: "ENGINE down", always: false });
  }
  return out;
}
var REPEAT_MS = 6e4;
var Cursor = external_exports.object({
  offset: external_exports.number().int().min(0),
  announced: external_exports.record(external_exports.string(), external_exports.number()).catch({})
});
function readCursor(runDir) {
  try {
    return Cursor.parse(JSON.parse(readFileSync(join(runDir, CURSOR), "utf8")));
  } catch {
    return { offset: 0, announced: {} };
  }
}
async function awaitWork(runDir, o) {
  const started = Date.now();
  const repeatMs = o.repeatMs ?? REPEAT_MS;
  const saved = readCursor(runDir);
  const announced = new Map(Object.entries(saved.announced));
  let offset = saved.offset;
  for (; ; ) {
    const read = readEventsFrom(runDir, offset);
    offset = read.cursor;
    const fresh = eventLines(read.events);
    const now = standing(runDir);
    const keys = new Set(now.map((s) => s.key));
    for (const key of [...announced.keys()]) if (!keys.has(key)) announced.delete(key);
    const clock = Date.now();
    const due = clock - started >= o.deadlineMs;
    const held = (key) => {
      const at = announced.get(key);
      return at !== void 0 && clock - at < repeatMs;
    };
    const report = now.filter((s) => s.always || due || !held(s.key));
    if (fresh.length > 0 || report.length > 0 || due) {
      const kept = now.map((s) => [
        s.key,
        report.includes(s) ? clock : announced.get(s.key) ?? clock
      ]);
      const cursor = { offset, announced: Object.fromEntries(kept) };
      writeAtomic(join(runDir, CURSOR), `${JSON.stringify(cursor)}
`);
      const lines = [...fresh, ...report.map((s) => s.line)];
      return lines.length > 0 ? lines : ["TIMEOUT rearm"];
    }
    await setTimeout(pollMsOf(o), void 0, { signal: o.signal });
  }
}

// src/pipeline/runtime.ts
var import_yaml5 = __toESM(require_dist());
var GATE_NAMES = ["test", "lint", "typecheck", "build"];
var CONFIG_STACK = ".marvin/config.json";
function hasFile(root, ...names) {
  return names.some((n) => existsSync(join(root, n)));
}
function hasFileMatching(root, re) {
  try {
    return readdirSync(root).some((f) => re.test(f));
  } catch {
    return false;
  }
}
var STACK_DETECTORS = [
  {
    id: "go",
    marker: "Go",
    detect: (r) => hasFile(r, "go.mod"),
    gates: { test: "go test ./...", lint: "golangci-lint run", build: "go build ./..." }
  },
  {
    id: "rust",
    marker: "Rust",
    detect: (r) => hasFile(r, "Cargo.toml"),
    gates: { test: "cargo test", lint: "cargo clippy", build: "cargo build" }
  },
  {
    id: "python",
    marker: "Python",
    detect: (r) => hasFile(r, "pyproject.toml", "setup.py", "setup.cfg"),
    gates: { test: "pytest", lint: "ruff check .", typecheck: "mypy ." }
  },
  {
    id: "typescript",
    marker: "TypeScript",
    detect: (r) => hasFile(r, "tsconfig.json"),
    gates: {
      test: "npm test",
      lint: "npx eslint .",
      typecheck: "npx tsc --noEmit",
      build: "npm run build"
    }
  },
  {
    id: "maven",
    marker: "Java (Maven)",
    detect: (r) => hasFile(r, "pom.xml"),
    gates: { test: "mvn test", build: "mvn package" }
  },
  {
    id: "gradle",
    marker: "JVM (Gradle)",
    detect: (r) => hasFile(r, "build.gradle", "build.gradle.kts"),
    gates: { test: "./gradlew test", build: "./gradlew build" }
  },
  {
    id: "dotnet",
    marker: "C#/.NET",
    detect: (r) => hasFileMatching(r, /\.(sln|csproj|fsproj)$/i) || hasFile(r, "global.json"),
    gates: {
      test: "dotnet test",
      lint: "dotnet format --verify-no-changes",
      build: "dotnet build"
    }
  },
  {
    id: "swift",
    marker: "Swift",
    detect: (r) => hasFile(r, "Package.swift"),
    gates: { test: "swift test", build: "swift build" }
  },
  {
    id: "ruby",
    marker: "Ruby",
    detect: (r) => hasFile(r, "Gemfile"),
    gates: { test: "bundle exec rspec", lint: "bundle exec rubocop" }
  },
  {
    id: "php",
    marker: "PHP",
    detect: (r) => hasFile(r, "composer.json"),
    gates: { test: "composer test" }
  },
  {
    id: "cpp",
    marker: "C/C++ (CMake)",
    detect: (r) => hasFile(r, "CMakeLists.txt"),
    // test/lint vary too much across C/C++ to default safely — declare them in
    // `.marvin/config.json`. The build gate configures then builds, so it is
    // self-contained (no dependence on a sibling gate running first).
    gates: { build: "cmake -B build && cmake --build build" }
  }
];
function resolveGatePlan(input) {
  const configGates = gateSpecsFromConfig(input.gates);
  const resolved = resolveStandard(input, configGates);
  const usesExtras = !(input.explicit?.length || input.only);
  const extra = usesExtras ? extraGateSpecs(input.gates) : [];
  let standard = resolved.gates;
  if (input.only) {
    const only = input.only;
    standard = standard.filter((g) => only.includes(g.name));
  }
  const stacks = extra.length > 0 && !resolved.stacks.includes(CONFIG_STACK) ? [...resolved.stacks, CONFIG_STACK] : resolved.stacks;
  return {
    stacks,
    detected: resolved.gates,
    standard,
    extra,
    usesExtras,
    gates: [...standard, ...extra]
  };
}
var SHELL_METACHARACTERS = /[|&;<>()$`\\"'*?[\]{}~#\n]/;
var ABSTAIN = { kind: "abstain" };
function planGates(gates, cwd) {
  const byToken = /* @__PURE__ */ new Map();
  return gates.map((gate) => {
    if (SHELL_METACHARACTERS.test(gate.command)) return { gate, probe: ABSTAIN };
    const token = gate.command.trim().split(/\s+/)[0];
    if (!token) return { gate, probe: ABSTAIN };
    let probe = byToken.get(token);
    if (!probe) {
      probe = probeToken(token, cwd);
      byToken.set(token, probe);
    }
    return { gate, probe };
  });
}
function probeToken(token, cwd) {
  const probe = spawnSync("sh", ["-c", `command -v -- ${token}`], { cwd, encoding: "utf8" });
  if (probe.error || probe.status === null) return ABSTAIN;
  return probe.status === 0 ? { kind: "available" } : { kind: "missing", token };
}
function evidenceGap(gates) {
  if (gates.length === 0) return null;
  const tests = gates.filter((g) => g.name === "test");
  if (tests.length > 0 && tests.every((g) => !g.ran)) return "test";
  if (gates.every((g) => !g.ran)) return "all";
  return null;
}
function unambiguousStackId(projectRoot) {
  const matched = STACK_DETECTORS.filter((d) => d.detect(projectRoot));
  return matched.length === 1 ? matched[0].id : void 0;
}
function resolveStandard(input, configGates) {
  if (input.explicit && input.explicit.length > 0) {
    return { stacks: ["explicit"], gates: [...input.explicit] };
  }
  const base = detectBase(input, input.projectRoot);
  if (configGates.length === 0) return base;
  return mergeConfigGates(base, configGates);
}
function detectBase(input, projectRoot) {
  if (input.stack) {
    const hinted = STACK_DETECTORS.find((d) => d.id === input.stack);
    if (hinted) return gatesFromStacks([hinted]);
  }
  const matched = STACK_DETECTORS.filter((d) => d.detect(projectRoot));
  if (matched.length === 0) {
    return detectGeneric(projectRoot);
  }
  return gatesFromStacks(matched);
}
function gatesFromStacks(detectors) {
  const stacks = [];
  const gates = [];
  for (const d of detectors) {
    stacks.push(d.marker);
    for (const name of GATE_NAMES) {
      const command = d.gates[name];
      if (command) gates.push({ name, command });
    }
  }
  return { stacks, gates };
}
function mergeConfigGates(base, configGates) {
  const gates = [];
  for (const name of GATE_NAMES) {
    const override = configGates.find((g) => g.name === name);
    if (override) gates.push(override);
    else gates.push(...base.gates.filter((g) => g.name === name));
  }
  return { stacks: [...base.stacks, CONFIG_STACK], gates };
}
function gateSpecsFromConfig(gates) {
  if (!gates) return [];
  const out = [];
  for (const name of GATE_NAMES) {
    const command = gates[name];
    if (command) out.push({ name, command });
  }
  return out;
}
function extraGateSpecs(gates) {
  return (gates?.extra ?? []).map((g) => ({ name: g.name, command: g.command, extra: true }));
}
var DECLARED_GATE_ALIASES = [
  ["test", ["test"]],
  ["lint", ["lint"]],
  ["typecheck", ["typecheck", "type-check", "tsc"]],
  ["build", ["build"]]
];
function detectGeneric(projectRoot) {
  const npm = detectNpmScripts(projectRoot);
  if (npm.gates.length) return npm;
  const make = detectMakefile(projectRoot);
  if (make.gates.length) return make;
  return { stacks: [], gates: [] };
}
function detectNpmScripts(projectRoot) {
  const pkgPath = join(projectRoot, "package.json");
  if (!existsSync(pkgPath)) return { stacks: [], gates: [] };
  let scripts = {};
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    scripts = pkg.scripts ?? {};
  } catch {
    return { stacks: [], gates: [] };
  }
  const gates = [];
  for (const [gate, aliases] of DECLARED_GATE_ALIASES) {
    const name = aliases.find(
      (a) => typeof scripts[a] === "string" && scripts[a].trim()
    );
    if (name) gates.push({ name: gate, command: `npm run ${name}` });
  }
  return gates.length ? { stacks: ["package.json scripts"], gates } : { stacks: [], gates: [] };
}
function detectMakefile(projectRoot) {
  const mkPath = join(projectRoot, "Makefile");
  if (!existsSync(mkPath)) return { stacks: [], gates: [] };
  let text2;
  try {
    text2 = readFileSync(mkPath, "utf8");
  } catch {
    return { stacks: [], gates: [] };
  }
  const targets = new Set(
    [...text2.matchAll(/^([A-Za-z][A-Za-z0-9_-]*):(?!=)/gm)].map((m) => m[1].toLowerCase())
  );
  const gates = [];
  for (const [gate, aliases] of DECLARED_GATE_ALIASES) {
    const name = aliases.find((a) => targets.has(a));
    if (name) gates.push({ name: gate, command: `make ${name}` });
  }
  return gates.length ? { stacks: ["Makefile"], gates } : { stacks: [], gates: [] };
}

// src/lib/oracles.ts
var import_yaml4 = __toESM(require_dist());
var SHELL_METACHARACTERS2 = /[;|&`\n<>]|\$\(/;
function splitRef(ref) {
  const i = ref.indexOf("::");
  return i === -1 ? { file: ref, name: "" } : { file: ref.slice(0, i).trim(), name: ref.slice(i + 2).trim() };
}
function packageDir(file) {
  const i = file.lastIndexOf("/");
  return i === -1 ? "." : `./${file.slice(0, i)}`;
}
var STACK_DEFAULTS = {
  python: ({ file, name }) => `pytest ${file}::${name}`,
  go: ({ file, name }) => `go test -run '^${name}$' ${packageDir(file)}`,
  rust: ({ name }) => `cargo test ${name}`
};
function isUnsafeOracleRef(criterion) {
  const oracle = criterion.oracle;
  if (oracle.run?.trim() || oracle.kind !== "test") return false;
  const ref = oracle.ref?.trim();
  if (!ref) return false;
  const parts = splitRef(ref);
  return SHELL_METACHARACTERS2.test(ref) || SHELL_METACHARACTERS2.test(parts.file) || SHELL_METACHARACTERS2.test(parts.name);
}
function resolveOracleCommand(criterion, opts) {
  const oracle = criterion.oracle;
  if (opts.call?.trim()) return { command: opts.call.trim(), source: "call" };
  if (oracle.run?.trim()) return { command: oracle.run.trim(), source: "oracle.run" };
  if (oracle.kind === "prose-review") {
    return { command: null, source: null, reason: "prose-review-oracle" };
  }
  const ref = oracle.ref?.trim();
  if (!ref) return { command: null, source: null, reason: "no-ref" };
  if (oracle.kind === "command") return { command: ref, source: "oracle.ref" };
  const parts = splitRef(ref);
  if (isUnsafeOracleRef(criterion)) return { command: null, source: null, reason: "unsafe-ref" };
  if (opts.testOne?.trim()) {
    const command = fillShellTemplate(opts.testOne, {
      "{file}": parts.file,
      "{name}": parts.name,
      "{ref}": ref
    }).trim();
    return command ? { command, source: "config.test_one" } : { command: null, source: null, reason: "empty-test_one" };
  }
  const row = opts.stack ? STACK_DEFAULTS[opts.stack] : void 0;
  if (!row) return { command: null, source: null, reason: "no-single-test-command" };
  if (!parts.name) return { command: null, source: null, reason: "ref-has-no-test-name" };
  return { command: row(parts), source: "stack-default" };
}
external_exports.object({
  /** The spec's validated kebab-case slug — also this journal's filename. */
  slug: external_exports.string().min(1),
  /** The seal this run was recorded against. Proofs never cross it. */
  contract_sha: external_exports.string().min(1),
  criterion: external_exports.string().min(1),
  /** Which phase this was: the red run expects `fail`, the green one `pass`. */
  expect: external_exports.enum(["pass", "fail"]),
  /** What happened. `not-run` covers an unresolved command, a signal kill and a
   * launch failure alike — none of them is evidence about the code. */
  status: external_exports.enum(["pass", "fail", "not-run"]),
  command: external_exports.string().nullable(),
  source: external_exports.string().nullable(),
  reason: external_exports.string().nullable().optional(),
  code: external_exports.number().nullable(),
  signal: external_exports.string().nullable(),
  /** The referenced test file and the hash of its bytes at run time — what makes
   * a red and a green comparable rather than merely consecutive. */
  test_file: external_exports.string().nullable(),
  test_sha: external_exports.string().nullable(),
  head_sha: external_exports.string().nullable(),
  durationMs: external_exports.number().optional(),
  ran_at: external_exports.string()
});

// src/lib/oracles.ts
function parseContractCriteria(blockText) {
  let parsed;
  try {
    parsed = SpecContract.safeParse((0, import_yaml4.parse)(blockText));
  } catch (err) {
    return {
      error: `spec-contract block is not valid YAML: ${err instanceof Error ? err.message : err}`
    };
  }
  if (!parsed.success) {
    return { error: `spec-contract block is invalid: ${parsed.error.issues[0]?.message ?? "?"}` };
  }
  return { criteria: parsed.data.criteria };
}
function resolveCriteria(criteria, opts) {
  return criteria.filter((criterion) => criterion.oracle.kind !== "prose-review").map((criterion) => ({ criterion, resolved: resolveOracleCommand(criterion, opts) }));
}
function resolveOracles(specText, opts = {}) {
  const block = extractContractBlock(parseFrontmatter(specText).body);
  if (block === null) throw new Error("the spec has no ```yaml spec-contract block");
  const parsed = parseContractCriteria(block);
  if ("error" in parsed) throw new Error(parsed.error);
  return resolveCriteria(parsed.criteria, {
    testOne: opts.testOne,
    stack: opts.stack,
    projectRoot: opts.projectRoot ?? ""
  }).map(({ criterion, resolved }) => ({
    criterion: criterion.id,
    command: resolved.command,
    reason: resolved.command === null ? resolved.reason : null
  }));
}

// src/storage/schema.ts
var TaskType = external_exports.enum(["bug", "feature", "chore", "spike"]);
var StatusRole = external_exports.enum(["todo", "wip", "review", "done", "blocked"]);
var StatusDef = external_exports.object({
  key: external_exports.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase alphanumerics and hyphens"),
  role: StatusRole,
  tracker_status: external_exports.string().min(1).optional()
});
var DEFAULT_STATUSES = [
  { key: "todo", role: "todo" },
  { key: "wip", role: "wip" },
  { key: "review", role: "review" },
  { key: "done", role: "done" },
  { key: "blocked", role: "blocked" }
];
var REQUIRED_ROLES = ["todo", "wip", "done"];
var Statuses = external_exports.array(StatusDef).superRefine((statuses, ctx) => {
  const seen = /* @__PURE__ */ new Set();
  for (const s of statuses) {
    if (seen.has(s.key)) {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: `duplicate status key "${s.key}"` });
    }
    seen.add(s.key);
  }
  for (const role of REQUIRED_ROLES) {
    if (!statuses.some((s) => s.role === role)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        message: `at least one status with role "${role}" is required`
      });
    }
  }
});
var TaskTitle = external_exports.string().min(3).max(120).regex(/^[^\u0000-\u001F\u007F-\u009F]+$/, "printable characters only (no control characters)");
var TrackerId = external_exports.string().regex(/^[A-Z]+-\d+$/, "Expected SHORT-123 format");
external_exports.object({
  id: external_exports.string().regex(/^\d{3}$/),
  type: TaskType,
  /**
   * A configured status key (ADR-0026). The schema only requires a string;
   * membership in the configured set is checked by `readAllTasks`, which
   * routes unknown keys through the malformed-file channel.
   */
  status: external_exports.string().min(1),
  title: TaskTitle,
  tracker_id: TrackerId.optional(),
  branch: external_exports.string(),
  /**
   * PR URL captured by the `task` tool's `link-pr` action (ADR-0024/0025).
   * Stored, never live-resolved; absent until a PR is opened for the task.
   */
  pr: external_exports.string().url().optional(),
  created: external_exports.string().datetime(),
  updated: external_exports.string().datetime()
});
external_exports.object({
  id: external_exports.string().regex(/^\d{3}$/),
  slug: external_exports.string().min(1),
  objective: external_exports.string().min(1),
  branch: external_exports.string().min(1),
  base: external_exports.string().min(1).optional(),
  pr_url: external_exports.string().url().optional(),
  spec_slug: external_exports.string().min(1).optional(),
  created: external_exports.string().datetime()
});
var STANDARD_GATE_NAMES = ["test", "lint", "typecheck", "build"];
var RESERVED_GATE_PREFIXES = ["prepare:", "oracle:"];
var GateExtra = external_exports.object({
  name: external_exports.string(),
  command: external_exports.string().min(1)
}).superRefine((gate, ctx) => {
  const name = gate.name.toLowerCase();
  const problem = RESERVED_GATE_PREFIXES.some((p) => name.startsWith(p)) ? `gate name "${gate.name}" is reserved: names starting with ${RESERVED_GATE_PREFIXES.join(" or ")} belong to the pipeline's gate stage` : STANDARD_GATE_NAMES.includes(name) ? `gate name "${gate.name}" is a standard gate (${STANDARD_GATE_NAMES.join(", ")}); extra gates need their own name` : /^[a-z0-9][a-z0-9_.-]*$/i.test(gate.name) ? null : `gate name "${gate.name}" must start with a letter or digit and use only letters, digits, "_", "." and "-"`;
  if (problem) ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: problem, path: ["name"] });
});
var GateExtraList = external_exports.array(GateExtra).superRefine((extra, ctx) => {
  const seen = /* @__PURE__ */ new Set();
  for (const gate of extra) {
    const name = gate.name.toLowerCase();
    if (seen.has(name)) {
      ctx.addIssue({ code: external_exports.ZodIssueCode.custom, message: `duplicate gate name "${gate.name}"` });
    }
    seen.add(name);
  }
});
var GateCommands = external_exports.object({
  test: external_exports.string().min(1).optional(),
  lint: external_exports.string().min(1).optional(),
  typecheck: external_exports.string().min(1).optional(),
  build: external_exports.string().min(1).optional(),
  /**
   * **Not a gate.** The template that runs ONE test — how a `kind: test`
   * acceptance oracle resolves to a command (ADR-0036). It is never scheduled,
   * never appears in a verdict and never reaches `verification.md`, and that is
   * mechanical rather than a convention: all three gate paths
   * (`gatesFromStacks`, `mergeConfigGates`, `gateSpecsFromConfig`) iterate the
   * `GATE_NAMES` tuple, so a key outside that tuple is structurally unreachable
   * as a gate. Leave those loops as they are.
   *
   * It must nonetheless be DECLARED here, because zod strips unknown keys
   * silently — ADR-0009 records that as an accepted trade-off ("a typo
   * (`tests:`) is stripped by the schema"). An undeclared `test_one` would
   * vanish inside `loadConfig` with no error anywhere to observe.
   *
   * Placeholders: `{file}`, `{name}`, `{ref}`. See docs/configuration.md.
   */
  test_one: external_exports.string().min(1).optional(),
  /**
   * Project gates that run AFTER the four standard ones, one at a time, in declaration order
   * (autopilot pipeline). Unlike `test`/`lint`/`typecheck`/`build` they are never detected from
   * the stack, and `verify`'s `only` and explicit per-call `gates` leave them out: the project
   * names them and `verify` runs them last. Entries are checked by `GateExtra`.
   */
  extra: GateExtraList.default([])
});
var AdrConfig = external_exports.object({
  dir: external_exports.string().min(1).optional(),
  index_file: external_exports.string().min(1).optional()
});
var SpecConfig = external_exports.object({
  dir: external_exports.string().min(1).optional()
});
var ScopeConfig = external_exports.object({
  exempt: external_exports.array(external_exports.string()).optional()
});
var UsageConfig = external_exports.object({
  enabled: external_exports.boolean().default(true)
});
var regexField = (field) => external_exports.string().min(1).superRefine((value, ctx) => {
  try {
    new RegExp(value);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      message: `${field} is not a valid regular expression: ${why}`
    });
  }
});
var PipelineConfig = external_exports.object({
  /** Run branch name; placeholders `{tracker}` and `{slug}`. */
  branch_template: external_exports.string().min(1).default("feature/{tracker}--{slug}"),
  /** Tracker id used in the branch name when the spec names none. */
  tracker_default: external_exports.string().min(1).default("TBD"),
  /** Command run once in a fresh run worktree before any child starts (e.g. `npm ci`). */
  bootstrap: external_exports.string().min(1).nullable().default(null),
  /** The lockfile the bootstrap installs from. */
  lockfile: external_exports.string().min(1).nullable().default(null),
  github: external_exports.object({
    /** Command printing the GitHub token the pipeline's `gh` calls use. */
    token_command: external_exports.string().min(1).nullable().default(null)
  }).default({}),
  /** Minutes without child output before the child counts as stalled. */
  stall_minutes: external_exports.number().int().min(1).default(15),
  /** Minutes after a push with no CI run appearing before the pipeline concludes there is no CI. */
  no_ci_minutes: external_exports.number().int().min(1).default(10),
  /** Minutes a single gate may run before it is killed. */
  gate_timeout_minutes: external_exports.number().int().min(1).default(20),
  /** Seconds between CI status polls. */
  ci_poll_seconds: external_exports.number().int().min(1).default(60),
  /** JavaScript regex over repo-relative paths: which files are tests (the test-author writes only these). */
  test_path_pattern: regexField("test_path_pattern").default(
    "(^|/)(__tests__/|[^/]+\\.(test|spec)\\.[cm]?[jt]sx?$)"
  ),
  /** JavaScript regex over repo-relative paths the scope gate tolerates as by-products. */
  scope_exempt_pattern: regexField("scope_exempt_pattern").nullable().default(null),
  /** Formatter run, with each written file appended, over files the pipeline itself writes. */
  format_command: external_exports.string().min(1).nullable().default(null),
  /** Project conventions handed to the verifier. */
  conventions: external_exports.string().default(""),
  /** Bash command prefixes the writing roles (planner, test-author, executor) may run. */
  allowed_commands: external_exports.array(external_exports.string()).superRefine((list2, ctx) => {
    list2.forEach((prefix, i) => {
      try {
        validatePrefix(prefix);
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        ctx.addIssue({
          code: external_exports.ZodIssueCode.custom,
          message: `allowed_commands entry is not usable: ${why}`,
          path: [i]
        });
      }
    });
  }).default(["git", "gh pr create", "gh pr view", "gh pr edit", "npm run", "npm ci", "npx --no"])
});
var Config = external_exports.object({
  base_branch: external_exports.string().default("dev"),
  /**
   * URL template for a task's external tracker item, with `{tracker_id}`
   * marking where the id goes. Whether it can actually substitute is checked
   * on the way out of `loadConfig`, not here: a `.refine()` would fail the
   * whole parse, so one mistyped template would reset `statuses`, `gates` and
   * `base_branch` to their defaults as well. The loader drops this field alone
   * and reports why (`trackerTemplateIssue`).
   */
  tracker_url_template: external_exports.string().nullable().default(null),
  gates: GateCommands.optional(),
  /** ADR corpus location + index target (ADR-0027); absent means detect/default. */
  adr: AdrConfig.optional(),
  /** Spec corpus location (ADR-0037); absent means detect/default. */
  spec: SpecConfig.optional(),
  /** By-product path patterns the scope gate and Q1 exempt (ADR-0045); absent means none. */
  scope: ScopeConfig.optional(),
  /**
   * What this host needs before a PR can merge — a version bump, a committed
   * build artefact, a changelog entry (ADR-0046). It used to be rewritten into
   * every spec's host-bindings block; `/marvin:task-start` now proposes it once
   * per project and turns each entry that touches a file into a contract row.
   * Absent means none recorded.
   */
  merge_obligations: external_exports.array(external_exports.string().min(1)).optional(),
  /** Usage-log kill-switch (ADR-0030); absent means enabled (opt-out telemetry). */
  usage: UsageConfig.optional(),
  /** The board's status vocabulary (ADR-0026); defaults to key == role. */
  statuses: Statuses.default(DEFAULT_STATUSES),
  /**
   * Branch-name template for new tasks (WP4). Placeholders: {type_prefix},
   * {type}, {seq}, {tracker}, {slug} — see `renderBranchTemplate`. Absent
   * means the default ADR-0019 scheme; a template that renders an invalid
   * git ref falls back to that default at create time (with a warning).
   */
  branch_template: external_exports.string().min(1).optional(),
  /** Autopilot pipeline settings; absent means every default. */
  pipeline: PipelineConfig.default({})
});
function run(cmd, args, cwd, opts) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    ...{},
    ...{}
  });
  if (result.error) {
    return { ok: false, code: -1, stderr: result.error.message };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      code: result.status ?? -1,
      stderr: (result.stderr || result.stdout || "").trim()
    };
  }
  return { ok: true, value: (result.stdout || "").trim() };
}
function git2(args, cwd, opts) {
  return run("git", args, cwd);
}
function inGitRepo(cwd) {
  return git2(["rev-parse", "--is-inside-work-tree"], cwd).ok;
}
function hasGit() {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function defaultBranchFromOrigin(cwd) {
  const r = git2(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], cwd);
  if (!r.ok || !r.value) return null;
  const name = r.value.replace(/^refs\/remotes\/origin\//, "");
  return name && name !== r.value ? name : null;
}

// src/storage/config.ts
function loadConfig(configPath, projectDir) {
  if (!existsSync(configPath)) {
    const config = Config.parse({});
    if (projectDir !== void 0 && hasGit() && inGitRepo(projectDir)) {
      const detected = defaultBranchFromOrigin(projectDir);
      if (detected) {
        config.base_branch = detected;
        return {
          config,
          warning: null,
          settingWarnings: [],
          pipelineIssues: [],
          base_branch_source: "origin/HEAD"
        };
      }
    }
    return {
      config,
      warning: null,
      settingWarnings: [],
      pipelineIssues: [],
      base_branch_source: "default"
    };
  }
  let raw;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err) {
    const reason2 = err instanceof Error ? err.message : String(err);
    return {
      config: Config.parse({}),
      warning: `failed to read config: ${reason2}`,
      settingWarnings: [],
      pipelineIssues: [],
      base_branch_source: "default"
    };
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    const reason2 = err instanceof Error ? err.message : String(err);
    return {
      config: Config.parse({}),
      warning: `config.json is not valid JSON: ${reason2}`,
      settingWarnings: [],
      pipelineIssues: [],
      base_branch_source: "default"
    };
  }
  const { json: usable, issues: pipelineIssues } = isolatePipelineSettings(json);
  const parsed = Config.safeParse(usable);
  if (!parsed.success) {
    return {
      config: Config.parse({}),
      warning: `config.json failed schema validation: ${parsed.error.message}`,
      settingWarnings: [],
      pipelineIssues: [],
      base_branch_source: "default"
    };
  }
  const hasOwnBase = typeof json === "object" && json !== null && Object.hasOwn(json, "base_branch");
  return {
    config: parsed.data,
    warning: null,
    settingWarnings: neutraliseUnusableSettings(parsed.data),
    pipelineIssues,
    base_branch_source: hasOwnBase ? "config" : "default"
  };
}
var isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var issuesAt = (error, prefix) => error.issues.map((i) => `${[prefix, ...i.path].join(".")}: ${i.message}`).join("; ");
function isolatePipelineSettings(json) {
  if (!isPlainObject(json)) return { json, issues: [] };
  let out = json;
  const issues = [];
  if (Object.hasOwn(out, "pipeline")) {
    const parsed = PipelineConfig.safeParse(out.pipeline);
    if (!parsed.success) {
      const { pipeline: _dropped, ...rest } = out;
      out = rest;
      issues.push(
        `\`pipeline\` is ignored \u2014 ${issuesAt(parsed.error, "pipeline")}. The pipeline will not start until it is fixed; its defaults are in force (\`/marvin:track-config\`).`
      );
    }
  }
  if (isPlainObject(out.gates) && Object.hasOwn(out.gates, "extra")) {
    const parsed = GateExtraList.safeParse(out.gates.extra);
    if (!parsed.success) {
      const { extra: _dropped, ...gates } = out.gates;
      out = { ...out, gates };
      issues.push(
        `\`gates.extra\` is ignored \u2014 ${issuesAt(parsed.error, "gates.extra")}. No extra gate runs, and the pipeline will not start, until it is fixed.`
      );
    }
  }
  return { json: out, issues };
}
function neutraliseUnusableSettings(config) {
  const warnings = [];
  if (config.tracker_url_template) {
    const issue = trackerTemplateIssue(config.tracker_url_template);
    if (issue) {
      warnings.push(
        `\`tracker_url_template\` ${JSON.stringify(config.tracker_url_template)} is ignored \u2014 ${issue}. Tasks show their tracker id without a link until it is fixed (\`/marvin:track-config\`).`
      );
      config.tracker_url_template = null;
    }
  }
  return warnings;
}
var PLACEHOLDER = /\{[^}]*\}/;
function trackerTemplateIssue(template) {
  if (!template.includes("{tracker_id}")) {
    return "it has no `{tracker_id}` placeholder, so a task's id has nowhere to go";
  }
  const leftover = PLACEHOLDER.exec(template.replaceAll("{tracker_id}", "TRACKER-1"));
  if (leftover) {
    return `it leaves \`${leftover[0]}\` unsubstituted \u2014 \`{tracker_id}\` is the only placeholder that gets filled in`;
  }
  return null;
}
var PASSING = /* @__PURE__ */ new Set(["success", "skipped", "neutral"]);
function classifyCi(i) {
  if (i.pr.state !== "OPEN") return { state: "closed", failing: [] };
  if (i.pr.mergeable === "CONFLICTING" || i.pr.mergeStateStatus === "DIRTY")
    return { state: "conflict", failing: [] };
  const mine = i.runs.filter((r) => r.head_sha === i.pr.headRefOid);
  if (mine.length === 0)
    return {
      state: i.minutesSincePush >= i.noCiAfterMinutes ? "no_ci" : "pending",
      failing: []
    };
  if (mine.some((r) => r.status !== "completed")) return { state: "pending", failing: [] };
  const failing = mine.filter((r) => !PASSING.has(r.conclusion ?? "")).map((r) => r.name);
  return { state: failing.length ? "red" : "green", failing };
}
function fetchCi(o) {
  const env = {
    ...process.env,
    ...o.tokenCommand ? {
      GH_TOKEN: execSync(o.tokenCommand, { encoding: "utf8" }).trim()
    } : {}
  };
  const gh = (...args) => execFileSync("gh", args, { cwd: o.worktree, env, encoding: "utf8" });
  const pr = JSON.parse(
    gh("pr", "view", o.prUrl, "--json", "state,mergeable,mergeStateStatus,headRefOid,headRefName")
  );
  const runs = JSON.parse(
    gh(
      "api",
      `repos/{owner}/{repo}/actions/runs?branch=${encodeURIComponent(pr.headRefName)}&per_page=50`,
      "--jq",
      ".workflow_runs"
    )
  );
  return { pr, runs };
}
var WRAPPER = [
  'out="$1"; err="$2"; exitf="$3"; shift 3',
  '"$@" < /dev/null > "$out" 2> "$err" &',
  "child=$!",
  `trap 'kill -TERM "$child" 2>/dev/null' TERM INT`,
  'wait "$child"; code=$?',
  'kill -0 "$child" 2>/dev/null && { wait "$child"; code=$?; }',
  'echo "$code" > "$exitf"'
].join("\n");
function launchDetached(cmd, runDir, name) {
  mkdirSync(runDir, { recursive: true });
  const logPath = join(runDir, `${name}.log.jsonl`);
  const errPath = join(runDir, `${name}.err`);
  const exitPath = join(runDir, `${name}.exit`);
  const child = spawn("/bin/sh", ["-c", WRAPPER, "sh", logPath, errPath, exitPath, ...cmd.argv], {
    cwd: cmd.cwd,
    env: { ...process.env, ...cmd.env },
    detached: true,
    stdio: "ignore"
  });
  let spawnError = null;
  child.on("error", (err) => {
    spawnError = err;
  });
  child.unref();
  if (child.pid === void 0) {
    const message = spawnError ? `failed to launch ${name}: ${spawnError.message}` : `failed to launch ${name}`;
    throw new Error(message);
  }
  return { pid: child.pid, logPath, errPath, exitPath };
}
var SANDBOX_VARIABLE = "MARVIN_PIPELINE_SANDBOX";
var MODEL_OVERRIDE_VARIABLE = "MARVIN_PIPELINE_MODEL_OVERRIDE";
var SANDBOX_PR_URL = "https://github.com/sandbox/sandbox/pull/1";
function sandboxSettings(env = process.env) {
  const raw = env[SANDBOX_VARIABLE];
  if (raw !== void 0 && raw !== "" && raw !== "1" && raw !== "0") {
    throw new Error(`${SANDBOX_VARIABLE} must be 1 or 0: ${raw}`);
  }
  const enabled = raw === "1";
  const override = env[MODEL_OVERRIDE_VARIABLE]?.trim() || null;
  if (override !== null) {
    modelFamily(override);
    if (!enabled) {
      throw new Error(
        `${MODEL_OVERRIDE_VARIABLE} is honoured only with ${SANDBOX_VARIABLE}=1; unset it, or run in the sandbox`
      );
    }
  }
  if (enabled && !env.MARVIN_PIPELINE_FAKE_CI) {
    throw new Error(
      `${SANDBOX_VARIABLE}=1 needs MARVIN_PIPELINE_FAKE_CI: the sandbox pull request does not exist on GitHub`
    );
  }
  return { enabled, modelOverride: override };
}
function effectiveAssignment(a, s) {
  return s.enabled && s.modelOverride !== null ? { ...a, model: s.modelOverride } : a;
}
var SHIM = String.raw`
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const STATE = process.env.MARVIN_SANDBOX_GH_STATE;
const URL = process.env.MARVIN_SANDBOX_GH_URL;
const args = process.argv.slice(2);
const git = (...a) => {
  try {
    return execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
const fail = (text) => {
  process.stderr.write(text + "\n");
  process.exit(1);
};
const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : null);
const save = (pr) => writeFileSync(STATE, JSON.stringify(pr, null, 2) + "\n");
const value = (long, short) => {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === long || (short && a === short)) return args[i + 1] ?? "";
    if (a.startsWith(long + "=")) return a.slice(long.length + 1);
  }
  return null;
};
const has = (name) => args.includes(name);
const body = () => {
  const file = value("--body-file", "-F");
  if (file !== null) return file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
  return value("--body", "-b");
};
const branch = () => git("rev-parse", "--abbrev-ref", "HEAD");
const fields = (pr) => ({
  url: pr.url,
  number: 1,
  state: pr.state,
  isDraft: pr.isDraft,
  title: pr.title,
  body: pr.body,
  baseRefName: pr.base,
  headRefName: pr.head,
  headRefOid: git("rev-parse", "HEAD"),
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: "",
  statusCheckRollup: [],
  comments: [],
  reviews: [],
});
const emit = (pr) => {
  const json = value("--json");
  if (json === null) {
    process.stdout.write(pr.title + "\n" + pr.url + "\n" + (pr.isDraft ? "draft" : "open") + "\n");
    return;
  }
  const all = fields(pr);
  const picked = Object.fromEntries(json.split(",").map((k) => [k.trim(), all[k.trim()] ?? null]));
  const jq = value("--jq", "-q");
  if (jq !== null) {
    const m = /^\.(\w+)$/.exec(jq.trim());
    if (!m) fail("gh (autopilot sandbox): only --jq .<field> is supported, not " + jq);
    const v = picked[m[1]];
    process.stdout.write((typeof v === "string" ? v : JSON.stringify(v)) + "\n");
    return;
  }
  process.stdout.write(JSON.stringify(picked) + "\n");
};
const current = () => {
  const pr = load();
  if (!pr || pr.head !== branch()) fail('no pull requests found for branch "' + branch() + '"');
  return pr;
};

const sub = (args[0] ?? "") + " " + (args[1] ?? "");
switch (sub) {
  case "pr create": {
    const existing = load();
    if (existing && existing.head === branch()) {
      fail('a pull request for branch "' + branch() + '" into branch "' + existing.base + '" already exists:\n' + existing.url);
    }
    const base = value("--base", "-B");
    if (!base) fail("gh (autopilot sandbox): pr create needs --base");
    const pr = {
      url: URL,
      state: "OPEN",
      isDraft: has("--draft") || has("-d"),
      title: value("--title", "-t") ?? git("log", "-1", "--format=%s"),
      body: body() ?? "",
      base,
      head: value("--head", "-H") ?? branch(),
    };
    save(pr);
    process.stdout.write(pr.url + "\n");
    break;
  }
  case "pr view":
    emit(current());
    break;
  case "pr list": {
    const pr = load();
    const mine = pr && pr.head === branch() ? [pr] : [];
    if (value("--json") === null) {
      for (const p of mine) process.stdout.write("1\t" + p.title + "\t" + p.head + "\n");
    } else {
      const keys = value("--json").split(",").map((k) => k.trim());
      const rows = mine.map((p) => Object.fromEntries(keys.map((k) => [k, fields(p)[k] ?? null])));
      process.stdout.write(JSON.stringify(rows) + "\n");
    }
    break;
  }
  case "pr edit": {
    const pr = current();
    const title = value("--title", "-t");
    const text = body();
    if (title !== null) pr.title = title;
    if (text !== null) pr.body = text;
    save(pr);
    process.stdout.write(pr.url + "\n");
    break;
  }
  case "pr ready": {
    const pr = current();
    pr.isDraft = false;
    save(pr);
    break;
  }
  case "pr diff": {
    const pr = current();
    process.stdout.write(git("diff", "origin/" + pr.base + "...HEAD") + "\n");
    break;
  }
  case "pr checks":
    current();
    fail('no checks reported on the "' + branch() + '" branch');
    break;
  case "run list":
    process.stdout.write(value("--json") === null ? "" : "[]\n");
    break;
  default:
    fail("gh " + sub.trim() + ": not available in the autopilot sandbox");
}
`;
function installSandboxGh(runDir, nodePath = process.execPath) {
  const bin = join(runDir, "sandbox-bin");
  mkdirSync(bin, { recursive: true });
  const script = join(bin, "gh-shim.mjs");
  writeFileSync(script, SHIM.trimStart());
  const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const gh = join(bin, "gh");
  writeFileSync(gh, `#!/bin/sh
exec ${quote(nodePath)} ${quote(script)} "$@"
`);
  chmodSync(gh, 493);
  return {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    MARVIN_SANDBOX_GH_STATE: join(runDir, "sandbox-gh.json"),
    MARVIN_SANDBOX_GH_URL: SANDBOX_PR_URL
  };
}
function sandboxChildEnv(runDir, s) {
  return s.enabled ? installSandboxGh(runDir) : {};
}
var RUNTIME_VARS = {
  planner: ["orchestrator", "child", "lessons", "plugin"],
  "test-author": ["orchestrator", "child", "lessons", "test_path_pattern"],
  executor: ["orchestrator", "child", "lessons", "plugin"],
  verifier: ["orchestrator", "child", "lessons", "conventions"],
  retro: ["orchestrator", "child", "lessons", "aggregate", "efficacy", "lessons_index"]
};
var PLACEHOLDER2 = /\{\{(\w+)\}\}/g;
function renderTemplate(text2, vars) {
  const used = /* @__PURE__ */ new Set();
  const out = text2.replace(PLACEHOLDER2, (_, name) => {
    const value = Object.hasOwn(vars, name) ? vars[name] : void 0;
    if (value === void 0) throw new Error(`missing template var: ${name}`);
    used.add(name);
    return value;
  });
  const unused = Object.keys(vars).filter((name) => !used.has(name));
  if (unused.length > 0) throw new Error(`unused template var: ${unused.join(", ")}`);
  return out;
}
function composePrompts(rolesDir, role, vars, resume2) {
  const read = (name) => readFileSync(join(rolesDir, name), "utf8");
  const system = `${read("common.md")}
${read(`${role}.md`)}`;
  if (resume2) return { system, user: renderTemplate("{{message}}", vars) };
  return { system, user: renderTemplate(read(`${role}.context.md`), vars) };
}
var EDIT_TOOLS = "Edit|Write|MultiEdit|NotebookEdit";
function buildRoleSettings(role, hooksDir) {
  const realHooksDir = realpathSync(hooksDir);
  const hook = (file) => ({
    type: "command",
    command: `node "${join(realHooksDir, file)}"`,
    timeout: 10
  });
  const pre = [
    { matcher: "Bash", hooks: [hook("child-git-guard.mjs")] },
    {
      matcher: "mcp__.*marvin.*__(task|tracker|spec|adr|lessons|verify|report)$",
      hooks: [hook("child-mcp-guard.mjs")]
    }
  ];
  if (role === "verifier" || role === "retro")
    pre.push({ matcher: "Bash", hooks: [hook("readonly-guard.mjs")] });
  if (role === "planner" || role === "test-author" || role === "executor")
    pre.push({ matcher: EDIT_TOOLS, hooks: [hook("worktree-boundary-guard.mjs")] });
  if (role === "executor") pre.push({ matcher: EDIT_TOOLS, hooks: [hook("sealed-guard.mjs")] });
  if (role === "test-author")
    pre.push({ matcher: EDIT_TOOLS, hooks: [hook("test-path-guard.mjs")] });
  const post = [
    { matcher: "SendMessage", hooks: [hook("message-log.mjs")] },
    { matcher: "*", hooks: [hook("heartbeat.mjs")] }
  ];
  return { outputStyle: "default", hooks: { PreToolUse: pre, PostToolUse: post } };
}
var STRUCTURED = /* @__PURE__ */ new Set(["needs_input", "spec_ready", "done", "failed"]);
function lastResultEvent(log) {
  const lines = log.trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line?.startsWith("{")) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "result") return event;
    } catch {
      continue;
    }
  }
  return null;
}
function classify(i) {
  const none = {
    sessionId: null,
    costUsd: null,
    durationMs: null,
    cacheReadTokens: null,
    structured: null
  };
  if (i.exitCode === null) {
    return i.idleMs >= i.stallMs ? {
      ...none,
      outcome: "stalled",
      detail: `no output for ${Math.round(i.idleMs / 6e4)} min`
    } : { ...none, outcome: "running", detail: "" };
  }
  const r = i.result;
  if (!r) return { ...none, outcome: "crashed", detail: `exit ${i.exitCode}, no result event` };
  const usage = r.usage ?? {};
  const meta = {
    sessionId: typeof r.session_id === "string" ? r.session_id : null,
    costUsd: typeof r.total_cost_usd === "number" ? r.total_cost_usd : null,
    durationMs: typeof r.duration_ms === "number" ? r.duration_ms : null,
    cacheReadTokens: typeof usage.cache_read_input_tokens === "number" ? usage.cache_read_input_tokens : null
  };
  const text2 = String(r.result ?? "");
  if (r.api_error_status === 429 || r.is_error === true && /usage limit|rate limit/i.test(text2)) {
    return { ...meta, structured: null, outcome: "limited", detail: text2.slice(0, 200) };
  }
  if (r.is_error === true)
    return { ...meta, structured: null, outcome: "failed", detail: String(r.subtype ?? "error") };
  const s = r.structured_output;
  if (!s || typeof s !== "object")
    return { ...meta, structured: null, outcome: "crashed", detail: "no structured_output" };
  const structured = s;
  const status2 = String(structured.status ?? "");
  if (!STRUCTURED.has(status2))
    return { ...meta, structured, outcome: "crashed", detail: `unknown status "${status2}"` };
  const failure = status2 === "failed" && typeof structured.failure === "string" ? structured.failure.trim().slice(0, 200) : "";
  return { ...meta, structured, outcome: status2, detail: failure };
}
function readChildState(runDir, name, nowMs) {
  const exitPath = join(runDir, `${name}.exit`);
  const logPath = join(runDir, `${name}.log.jsonl`);
  const raw = existsSync(exitPath) ? readFileSync(exitPath, "utf8").trim() : "";
  const hasLog = existsSync(logPath);
  const result = hasLog ? lastResultEvent(readFileSync(logPath, "utf8")) : null;
  const exitCode = raw === "" ? result ? 0 : null : Number(raw);
  return { exitCode, result, idleMs: hasLog ? nowMs - statSync(logPath).mtimeMs : 0 };
}
function summaryLine(name, r) {
  const cost = r.costUsd === null ? "?" : `$${r.costUsd.toFixed(2)}`;
  const dur = r.durationMs === null ? "?" : `${Math.round(r.durationMs / 6e4)}m`;
  const detail = r.detail ? ` detail=${JSON.stringify(r.detail)}` : "";
  return `CHILD ${name} outcome=${r.outcome} cost=${cost} dur=${dur} session=${r.sessionId ?? "-"}${detail}`;
}

// src/pipeline/runtime.ts
var WorktreeRecord = external_exports.object({
  path: external_exports.string().min(1),
  branch: external_exports.string().min(1),
  baseSha: external_exports.string().regex(/^[0-9a-f]{40}$/),
  gitDir: external_exports.string().min(1),
  originUrl: external_exports.string().min(1).optional()
});
var SpawnMarker = external_exports.object({
  ref: external_exports.string(),
  key: external_exports.string(),
  name: external_exports.string(),
  startedAt: external_exports.string(),
  pid: external_exports.number().int().nullable()
});
var SealedEntry = external_exports.object({
  path: external_exports.string(),
  sha256: external_exports.string(),
  criteria: external_exports.array(external_exports.string())
});
var SealMarker = external_exports.object({
  phase: external_exports.enum(["sealed", "committed"]),
  headBefore: external_exports.string(),
  sealed: external_exports.array(SealedEntry),
  commit: external_exports.string().optional()
});
var GatedHead = external_exports.object({ head: external_exports.string(), iteration: external_exports.number().int(), passed: external_exports.boolean() });
var CiPoll = external_exports.object({ stage: external_exports.string(), ciSince: external_exports.string().nullable() });
var RegexSource = external_exports.string().min(1).refine((source) => {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}, "is not a valid regular expression");
var CheckRuleShape = external_exports.object({
  id: external_exports.string().min(1),
  pattern: RegexSource,
  path_pattern: RegexSource.optional(),
  exclude_pattern: RegexSource.optional(),
  message: external_exports.string().min(1),
  severity: external_exports.enum(SEVERITIES).optional(),
  category: external_exports.string().min(1).optional()
});
var CI_STATES = ["green", "red", "pending", "conflict", "no_ci", "closed"];
var FULL_SHA4 = /^[0-9a-f]{40}$/;
var PLAIN_TOKEN2 = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
var CONFIG_PATH = ".marvin/config.json";
var CHECKS_PATH2 = ".marvin/pipeline/checks.yaml";
var CALIBRATION_PATH2 = ".marvin/pipeline/calibration.jsonl";
var MEMORY_DIR2 = ".marvin/memory";
var LESSON_LIMIT = 8;
var GITLINK = "160000";
var NESTED_REPO2 = "nested-repo";
var CHILD_DEADLINE_MS = 110 * 6e4;
var resolveOrNull = (value) => value ? resolve(value) : null;
var errorText3 = (error) => error instanceof Error ? error.message : String(error);
function writeAtomic2(path, text2) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  );
  writeFileSync(tmp, text2);
  renameSync(tmp, path);
}
function readJson(path, schema) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success)
    throw new Error(`${path} is not what the runtime wrote: ${parsed.error.message}`);
  return parsed.data;
}
var git3 = (cwd, ...args) => execFileSync("git", [...HARDENED_GIT_OPTIONS, ...args], {
  cwd,
  env: hardenedGitEnv(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
}).trim();
function readEventsTolerant(runDir) {
  let text2;
  try {
    text2 = readFileSync(join(runDir, "events.jsonl"), "utf8");
  } catch {
    return [];
  }
  return text2.split("\n").flatMap((line) => {
    try {
      const e = JSON.parse(line);
      return e && typeof e.kind === "string" && typeof e.text === "string" ? [e] : [];
    } catch {
      return [];
    }
  });
}
function physicallyInside(root, target) {
  const rel = relative(realpathSync(root), realpathSync(target));
  return rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function committedText(wt, rev, path) {
  try {
    return isolatedGit(wt.path, wt.gitDir).bytes("cat-file", "blob", `${rev}:${path}`).toString("utf8");
  } catch {
    return null;
  }
}
function runConfig(wt, copy, projectDir) {
  const text2 = committedText(wt, wt.baseSha, CONFIG_PATH);
  if (text2 === null) rmSync(copy, { force: true });
  else writeAtomic2(copy, text2);
  return loadConfig(copy, projectDir);
}
function evidenceFindings(planned) {
  const absent = planned.flatMap((g) => g.missing === void 0 ? [] : [`\`${g.missing}\``]);
  const fix = "the runner installed, or a command pinned in .marvin/config.json on the base branch";
  if (planned.length === 0) {
    return [
      {
        id: "G-no-evidence",
        severity: "blocker",
        category: "gate",
        claim: "no quality gate is planned for this project, so nothing beyond the oracles is run",
        evidence: "verify's plan: no known stack, no declared script or target, no configured gate",
        expected: `gates declared: ${fix}`
      }
    ];
  }
  const gap = evidenceGap(planned.map((g) => ({ name: g.name, ran: g.missing === void 0 })));
  if (gap === null) return [];
  return [
    {
      id: gap === "test" ? "G-no-test-evidence" : "G-no-evidence",
      severity: "blocker",
      category: "gate",
      claim: gap === "test" ? "no test evidence: every `test` gate was not run" : "no evidence: every planned gate was not run",
      evidence: `not on PATH: ${absent.join(", ")}; verify's delivery gate refuses such a run`,
      expected: fix
    }
  ];
}
function stageGates(projectRoot, config) {
  const { gates } = resolveGatePlan({ projectRoot, gates: config.gates });
  return planGates(gates, projectRoot).map(({ gate, probe }) => ({
    name: gate.name,
    command: gate.command,
    ...probe.kind === "missing" ? { missing: probe.token } : {}
  }));
}
function childKey(before, name) {
  const attempt = before.filter((c) => c.name === name).length + 1;
  return attempt === 1 ? name : `${name}.${attempt}`;
}
var ORCHESTRATOR_FILE = "orchestrator.txt";
function assertOrchestratorName(name) {
  if (!/^[\w.-]+$/.test(name)) {
    throw new Error(`invalid orchestrator name: ${JSON.stringify(name)}`);
  }
}
function writeOrchestrator(runDir, name) {
  assertOrchestratorName(name);
  writeAtomic2(join(runDir, ORCHESTRATOR_FILE), `${name}
`);
}
function orchestratorOf(runDir, run2) {
  let text2;
  try {
    text2 = readFileSync(join(runDir, ORCHESTRATOR_FILE), "utf8").trim();
  } catch {
    return run2.orchestratorName;
  }
  return text2 === "" ? run2.orchestratorName : text2;
}
var fakeVariable = (role) => `MARVIN_PIPELINE_FAKE_${role.toUpperCase().replace(/-/g, "_")}`;
var fakeScriptVariable = (role) => `${fakeVariable(role)}_SCRIPT`;
function fakeArgv(file, role, run2, key, script) {
  const fixture = JSON.parse(readFileSync(file, "utf8"));
  const earlier = run2.children.filter((c) => c.role === role).length;
  const output = Array.isArray(fixture) ? fixture[Math.min(earlier, fixture.length - 1)] : fixture;
  const event = {
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: `fake-${key}`,
    total_cost_usd: 0,
    duration_ms: 0,
    num_turns: 1,
    usage: { cache_read_input_tokens: 0 },
    structured_output: output
  };
  const before = script ? `require("node:child_process").execFileSync(process.execPath, ${JSON.stringify([script, String(earlier + 1)])}, { stdio: ["ignore", "ignore", "inherit"] });` : "";
  return [
    process.execPath,
    "-e",
    `${before}process.stdout.write(${JSON.stringify(`${JSON.stringify(event)}
`)})`
  ];
}
function createRuntime(o) {
  const { rubric } = o;
  const runDir = resolve(o.runDir);
  const pluginRoot = resolve(o.pluginRoot);
  const pipelineDir = join(pluginRoot, "pipeline");
  const rolesDir = join(pipelineDir, "roles");
  const schemasDir = join(pipelineDir, "schemas");
  const hooksDir = join(pipelineDir, "hooks");
  const runner = o.runner ?? shellRunner;
  const pollMs = o.pollMs ?? 1e3;
  const childDeadlineMs = o.childDeadlineMs ?? CHILD_DEADLINE_MS;
  const at = (name) => join(runDir, name);
  const now = () => (/* @__PURE__ */ new Date()).toISOString();
  const childPluginDir = () => resolve(process.env.MARVIN_PIPELINE_PLUGIN_DIR || pluginRoot);
  const sandbox = sandboxSettings();
  const note = (text2, data = {}) => appendEvent(runDir, { ts: now(), kind: "note", actor: "engine", text: text2, data });
  const noteOnce = (ref, text2) => {
    if (readEventsTolerant(runDir).some((e) => e.data?.ref === ref)) return;
    note(text2, { notify: true, ref });
  };
  const worktreeRecord = (run2) => {
    const record = readJson(at("worktree.json"), WorktreeRecord);
    if (!record) throw new Error(`run ${run2.id} has no worktree record; prepare has not run`);
    if (run2.worktree !== null && run2.worktree !== record.path) {
      throw new Error(`the run names worktree ${run2.worktree}, its record ${record.path}`);
    }
    return record;
  };
  let cached = null;
  const configFor = (run2) => {
    if (o.config) return o.config;
    if (cached) return cached;
    const loaded = runConfig(worktreeRecord(run2), at("base-config.json"), run2.repoRoot);
    const problems = [...loaded.warning ? [loaded.warning] : [], ...loaded.pipelineIssues];
    if (problems.length > 0) {
      throw new Error(`the pipeline does not run on this configuration: ${problems.join("; ")}`);
    }
    cached = loaded.config;
    return loaded.config;
  };
  const checkMainConfig = (run2, wt) => {
    let main2;
    try {
      main2 = readFileSync(join(run2.repoRoot, CONFIG_PATH), "utf8");
    } catch {
      return;
    }
    const base = committedText(wt, wt.baseSha, CONFIG_PATH);
    if (base === main2) return;
    if (base !== null) {
      noteOnce(
        "config:main-checkout",
        `the main checkout's ${CONFIG_PATH} differs from the one committed at ${run2.base}; the run uses the one committed at ${run2.base}, as its children do`
      );
      return;
    }
    let keys = [];
    try {
      const json = JSON.parse(main2);
      if (typeof json === "object" && json !== null && !Array.isArray(json)) {
        keys = ["gates", "pipeline"].filter((k) => Object.hasOwn(json, k));
      }
    } catch {
    }
    if (keys.length === 0) return;
    throw new Error(
      `${CONFIG_PATH} is not committed at ${run2.base} (${wt.baseSha.slice(0, 12)}), and the main checkout's sets ${keys.map((k) => `\`${k}\``).join(" and ")}, which neither this run nor its children would see: commit it on ${run2.base} (\`git add -f\` where .marvin/ is ignored), or remove those keys`
    );
  };
  const protectedPatterns = () => external_exports.array(external_exports.string()).parse(JSON.parse(readFileSync(join(pipelineDir, "protected.default.json"), "utf8")));
  const adoptWorktree = (run2, path, branch) => {
    const refuse = (why) => new Error(`refusing to adopt ${path} as run ${run2.id}'s worktree: ${why}`);
    let top;
    let common;
    let gitDir;
    let onBranch;
    try {
      top = git3(path, "rev-parse", "--show-toplevel");
      common = git3(path, "rev-parse", "--path-format=absolute", "--git-common-dir");
      gitDir = git3(path, "rev-parse", "--absolute-git-dir");
      onBranch = git3(path, "symbolic-ref", "--short", "HEAD");
    } catch (error) {
      throw refuse(`it is not a git worktree (${errorText3(error)})`);
    }
    const repoCommon = git3(run2.repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir");
    if (realpathSync(top) !== realpathSync(path)) throw refuse(`its top level is ${top}`);
    if (realpathSync(common) !== realpathSync(repoCommon))
      throw refuse("it belongs to another repository");
    if (onBranch !== branch) throw refuse(`it is on ${onBranch}, not ${branch}`);
    const baseSha = git3(path, "rev-parse", "--verify", "HEAD^{commit}");
    return { path, branch, baseSha, gitDir };
  };
  const setUpWorktree = (run2) => {
    const saved = readJson(at("worktree.json"), WorktreeRecord);
    if (saved) {
      if (!existsSync(saved.path)) throw new Error(`the run's worktree ${saved.path} is gone`);
      return saved;
    }
    const worktreesRoot = join(stateRoot(), "worktrees");
    const path = join(worktreesRoot, basename(run2.repoRoot), run2.id);
    const made = existsSync(path) ? adoptWorktree(run2, path, `autopilot/${run2.id}`) : createRunWorktree({ repoRoot: run2.repoRoot, base: run2.base, runId: run2.id, worktreesRoot });
    let originUrl;
    try {
      originUrl = git3(run2.repoRoot, "remote", "get-url", "origin") || void 0;
    } catch {
      originUrl = void 0;
    }
    const record = { ...made, ...originUrl ? { originUrl } : {} };
    writeAtomic2(at("worktree.json"), `${JSON.stringify(record, null, 2)}
`);
    return record;
  };
  const bootstrap = (config, worktree) => {
    const command = config.pipeline.bootstrap;
    if (!command) return;
    const marker = at("bootstrap.json");
    if (readJson(marker, external_exports.object({ command: external_exports.string() }))?.command === command) return;
    const timeout = config.pipeline.gate_timeout_minutes * 6e4;
    const result = runner(`export HUSKY=0; ${command}`, worktree, timeout);
    if (result.code !== 0) {
      const tail = result.output.trimEnd().split("\n").slice(-20).join("\n");
      throw new Error(`bootstrap \`${command}\` failed (exit ${result.code}):
${tail}`);
    }
    writeAtomic2(marker, `${JSON.stringify({ command })}
`);
  };
  const prepare = async (run2) => {
    const record = setUpWorktree(run2);
    const config = configFor(run2);
    if (!o.config) checkMainConfig(run2, record);
    bootstrap(config, record.path);
    writeAtomic2(
      at("test-paths.json"),
      `${JSON.stringify({ pattern: config.pipeline.test_path_pattern })}
`
    );
    if (!existsSync(at("sealed.json"))) writeSealManifest(runDir, []);
    if (!existsSync(at("protected-baseline.json"))) {
      const baseline = snapshotProtected(record.path, record.gitDir, protectedPatterns());
      writeAtomic2(at("protected-baseline.json"), `${JSON.stringify(baseline, null, 2)}
`);
    }
    return { ...run2, worktree: record.path, branch: record.branch };
  };
  const lessonRoot = (run2) => run2.worktree ?? run2.repoRoot;
  const readLessons = (run2) => {
    const dir = join(lessonRoot(run2), MEMORY_DIR2);
    let names;
    try {
      names = readdirSync(dir).sort();
    } catch (error) {
      if (error.code !== "ENOENT") {
        noteOnce(
          `lessons:${MEMORY_DIR2}`,
          `${MEMORY_DIR2} cannot be listed, so no lesson reaches a prompt: ${errorText3(error)}`
        );
      }
      return [];
    }
    return names.flatMap((name) => {
      if (!name.endsWith(".md") || name === "MEMORY.md") return [];
      const path = join(dir, name);
      try {
        if (!lstatSync(path).isFile()) throw new Error("it is not a regular file");
        const { frontmatter, body } = parseFrontmatter(readFileSync(path, "utf8"));
        if (!frontmatter.title) return [];
        const tags = (frontmatter.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
        const created = frontmatter.created ?? "";
        return [
          { slug: name.slice(0, -3), title: frontmatter.title, created, tags, body: body.trim() }
        ];
      } catch (error) {
        noteOnce(
          `lessons:${MEMORY_DIR2}/${name}`,
          `lesson ${MEMORY_DIR2}/${name} was left out of the prompts: ${errorText3(error)}`
        );
        return [];
      }
    });
  };
  const allLessons = (run2) => readLessons(run2).map((l) => ({ id: l.slug, title: l.title, tags: l.tags, body: l.body }));
  const specOnDisk = (run2) => {
    if (run2.worktree === null || run2.specPath === null || !isCanonicalPath(run2.specPath))
      return null;
    const abs = join(run2.worktree, run2.specPath);
    try {
      if (!physicallyInside(run2.worktree, abs)) return null;
      return readFileSync(abs, "utf8");
    } catch {
      return null;
    }
  };
  const contractPaths = (run2) => {
    const text2 = specOnDisk(run2);
    if (text2 === null) return [];
    try {
      return readSignals(text2, rubric).paths;
    } catch {
      return [];
    }
  };
  const recordExposure = (ids) => {
    if (ids.length === 0) return;
    const known = readJson(at("lessons-exposed.json"), external_exports.array(external_exports.string())) ?? [];
    const merged = [.../* @__PURE__ */ new Set([...known, ...ids])];
    if (merged.length !== known.length) {
      writeAtomic2(at("lessons-exposed.json"), `${JSON.stringify(merged)}
`);
    }
  };
  const calibrationRecords = (run2) => {
    let text2;
    try {
      text2 = readFileSync(join(lessonRoot(run2), CALIBRATION_PATH2), "utf8");
    } catch {
      return [];
    }
    const Record = external_exports.object({
      ts: external_exports.string(),
      findingCategories: external_exports.array(external_exports.string()),
      exposedLessons: external_exports.array(external_exports.string())
    });
    return text2.split("\n").flatMap((line) => {
      try {
        const parsed = Record.safeParse(JSON.parse(line));
        return parsed.success ? [parsed.data] : [];
      } catch {
        return [];
      }
    });
  };
  const efficacyText = (run2) => {
    const items = readLessons(run2).flatMap((l) => {
      const target = l.tags.find((t) => t.startsWith("target:"))?.slice("target:".length);
      return target && l.created ? [{ id: l.slug, kind: "lesson", createdAt: l.created, targetCategory: target }] : [];
    });
    const results = efficacy(calibrationRecords(run2), items);
    if (results.length === 0) return "(none)";
    const rate = (n) => n.toFixed(2);
    return results.map(
      (r) => `- ${r.id} (lesson): ${r.verdict}; exposed in ${r.exposure} runs; target-category rate ${rate(r.before)} before, ${rate(r.after)} after`
    ).join("\n");
  };
  const runtimeVars = (run2, action, name, config) => {
    const { role } = action;
    for (const v of RUNTIME_VARS[role]) {
      if (Object.hasOwn(action.context, v)) {
        throw new Error(`the engine's context for ${role} carries the runtime's ${v}`);
      }
    }
    const ranked = rankLessons(allLessons(run2), {
      role,
      paths: contractPaths(run2),
      limit: LESSON_LIMIT
    });
    const supply = {
      orchestrator: () => orchestratorOf(runDir, run2),
      child: () => name,
      lessons: () => lessonsMarkdown(ranked),
      test_path_pattern: () => config.pipeline.test_path_pattern,
      conventions: () => config.pipeline.conventions.trim() || "(none)",
      aggregate: () => JSON.stringify(aggregate(run2, readEventsTolerant(runDir)), null, 2),
      efficacy: () => efficacyText(run2),
      lessons_index: () => lessonsMarkdown(allLessons(run2)),
      plugin: () => childPluginDir()
    };
    const vars = Object.fromEntries(RUNTIME_VARS[role].map((v) => [v, supply[v]()]));
    recordExposure(ranked.map((l) => l.id));
    return vars;
  };
  const probePrefixes = (config) => {
    const template = config.gates?.test_one;
    const cut = template?.indexOf("{file}") ?? -1;
    if (!template || cut < 0) return [];
    const prefix = template.slice(0, cut).trim();
    try {
      validatePrefix(prefix);
      return [prefix];
    } catch (error) {
      note(`the verifier gets no test probe: ${errorText3(error)}`);
      return [];
    }
  };
  const markerPath = (ref) => at(join("spawns", `${ref}.json`));
  const runningRow = (run2, action, marker) => {
    const child = {
      name: marker.name,
      role: action.role,
      iteration: action.iteration,
      sessionId: null,
      pid: marker.pid,
      assignment: action.assignment,
      startedAt: marker.startedAt,
      endedAt: null,
      status: "running",
      costUsd: null,
      cacheReadTokens: null
    };
    return { ...run2, children: [...run2.children, child] };
  };
  const spawnChild = (run2, planned, step2) => {
    const action = {
      ...planned,
      assignment: effectiveAssignment(planned.assignment, sandbox)
    };
    const config = configFor(run2);
    const { role } = action;
    if (run2.worktree === null) throw new Error(`cannot spawn ${role}: the run has no worktree`);
    const worktree = run2.worktree;
    const name = `${run2.id}-${role}-${action.iteration}`;
    const key = childKey(run2.children, name);
    const earlier = step2.replay ? readJson(markerPath(step2.ref), SpawnMarker) : null;
    const opened = [".log.jsonl", ".err", ".exit"].some((ext) => existsSync(at(`${key}${ext}`)));
    if (earlier) {
      if (earlier.key !== key) {
        throw new Error(
          `spawn ${step2.ref} launched ${earlier.key}, and its replay would be ${key}`
        );
      }
      if (earlier.pid !== null || opened) return runningRow(run2, action, earlier);
    } else if (opened) {
      throw new Error(`files of an earlier launch exist for ${key}; refusing to launch over them`);
    }
    const vars = action.resume ? { ...action.context } : { ...action.context, ...runtimeVars(run2, action, name, config) };
    const { system, user } = composePrompts(rolesDir, role, vars, action.resume);
    const systemPromptPath = at(`${role}.system.md`);
    const settingsPath = at(`${role}.settings.json`);
    writeAtomic2(systemPromptPath, system);
    writeAtomic2(at(`${key}.prompt.md`), user);
    writeAtomic2(settingsPath, `${JSON.stringify(buildRoleSettings(role, hooksDir), null, 2)}
`);
    const schema = readFileSync(join(schemasDir, `${role}.schema.json`), "utf8").trim();
    const allowedTools = READ_ONLY_ROLES.has(role) ? readOnlyAllowedTools(role === "verifier" ? probePrefixes(config) : []) : writingAllowedTools(config.pipeline.allowed_commands);
    let resumeSessionId;
    if (action.resume) {
      for (const c of run2.children)
        if (c.role === role && c.sessionId) resumeSessionId = c.sessionId;
      if (!resumeSessionId) throw new Error(`cannot resume ${role}: no earlier ${role} session`);
    }
    const real = buildChildCommand({
      role,
      name,
      cwd: worktree,
      runDir,
      orchestratorName: orchestratorOf(runDir, run2),
      base: run2.base,
      assignment: action.assignment,
      prompt: user,
      settingsPath,
      systemPromptPath,
      schema,
      ...resumeSessionId ? { resumeSessionId } : {},
      allowedTools,
      ...role === "test-author" ? { testPathPattern: config.pipeline.test_path_pattern } : {},
      pluginDir: childPluginDir(),
      branch: run2.branch
    });
    const sandboxEnv = sandboxChildEnv(runDir, sandbox);
    const live = { ...real, env: { ...real.env, ...sandboxEnv } };
    const fakeFile = process.env[fakeVariable(role)] || null;
    const fakeScript = fakeFile ? resolveOrNull(process.env[fakeScriptVariable(role)]) : null;
    const cmd = fakeFile ? { ...live, argv: fakeArgv(fakeFile, role, run2, key, fakeScript) } : live;
    const sandboxed = sandbox.enabled ? { sandbox: { modelOverride: sandbox.modelOverride, planned: planned.assignment } } : {};
    writeAtomic2(
      at(`${key}.command.json`),
      `${JSON.stringify({ argv: live.argv, env: live.env, cwd: live.cwd, fake: fakeFile, ...fakeScript ? { fakeScript } : {}, ...sandboxed }, null, 2)}
`
    );
    const mainBefore = at(`${key}.main-before.txt`);
    if (!existsSync(mainBefore)) writeAtomic2(mainBefore, snapshotTree(run2.repoRoot));
    const marker = { ref: step2.ref, key, name, startedAt: now(), pid: null };
    writeAtomic2(markerPath(step2.ref), `${JSON.stringify(marker)}
`);
    const { pid } = launchDetached(cmd, runDir, key);
    const launched = { ...marker, pid };
    writeAtomic2(markerPath(step2.ref), `${JSON.stringify(launched)}
`);
    appendEvent(runDir, {
      ts: now(),
      kind: "assignment",
      actor: "engine",
      text: `${name} started on ${action.assignment.model}/${action.assignment.effort}${action.resume ? " (resumed)" : ""}`,
      data: { ref: step2.ref, key, ...fakeFile ? { fake: true } : {} }
    });
    return runningRow(run2, action, launched);
  };
  const withSignals = (run2, result) => {
    const spec = result.structured?.spec;
    const path = spec?.path;
    if (!isCanonicalPath(path) || run2.worktree === null) return { result };
    try {
      const abs = join(run2.worktree, path);
      if (!physicallyInside(run2.worktree, abs)) throw new Error("it leads out of the worktree");
      return { result, signals: readSignals(readFileSync(abs, "utf8"), rubric) };
    } catch (error) {
      const detail = `spec_ready names ${path}, which the engine cannot read: ${errorText3(error)}`;
      return { result: { ...result, outcome: "crashed", detail: detail.slice(0, 300) } };
    }
  };
  const stopStalled = (pid, key) => {
    let command = "";
    try {
      command = execFileSync("ps", ["-ww", "-o", "command=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
    } catch {
    }
    if (![`${key}.log.jsonl`, `${key}.exit`].every((file) => command.includes(`${sep}${file}`))) {
      noteOnce(
        `stalled:${key}`,
        `${key} stalled, and process group ${pid} was not signalled: its leader is no longer the child's wrapper`
      );
      return;
    }
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
    }
  };
  const waitChild = async (run2, signal) => {
    let index = -1;
    run2.children.forEach((c, i) => {
      if (c.status === "running") index = i;
    });
    const child = run2.children[index];
    if (!child) throw new Error("no running child to wait for");
    const key = childKey(run2.children.slice(0, index), child.name);
    const config = configFor(run2);
    const stallMs = config.pipeline.stall_minutes * 6e4;
    const started = Date.now();
    let result;
    for (; ; ) {
      result = classify({ ...readChildState(runDir, key, Date.now()), stallMs });
      if (result.outcome !== "running" || Date.now() - started >= childDeadlineMs) break;
      await setTimeout(pollMs, void 0, { signal: signal ?? deps.signal });
    }
    if (result.outcome === "running") {
      return { run: run2, obs: { kind: "child", role: child.role, result } };
    }
    if (result.outcome === "stalled" && child.pid) stopStalled(child.pid, key);
    const obs = {
      kind: "child",
      role: child.role,
      result
    };
    if (child.role === "planner" && result.outcome === "spec_ready") {
      const read = withSignals(run2, result);
      obs.result = read.result;
      if (read.signals) obs.signals = read.signals;
    }
    const mainBefore = at(`${key}.main-before.txt`);
    if (existsSync(mainBefore)) {
      const leaked = diffSnapshots(readFileSync(mainBefore, "utf8"), snapshotTree(run2.repoRoot));
      if (leaked.length > 0) obs.leaked = leaked;
    } else {
      note(`no main-checkout snapshot for ${key}; its leak check was skipped`, { notify: true });
    }
    if (child.role === "verifier") {
      const before = at("snapshot.txt");
      const mutated = run2.worktree === null ? ["the run has no worktree to compare"] : existsSync(before) ? diffSnapshots(readFileSync(before, "utf8"), snapshotTree(run2.worktree)) : ["no snapshot of the tree was taken before the verifier"];
      if (mutated.length > 0) obs.mutated = mutated;
    }
    const resultPath = at(`${key}.result.json`);
    const first = !existsSync(resultPath);
    const { signals: _signals, ...recorded } = obs;
    writeAtomic2(resultPath, `${JSON.stringify(recorded, null, 2)}
`);
    if (first) {
      appendEvent(runDir, {
        ts: now(),
        kind: "report",
        actor: "engine",
        text: summaryLine(child.name, obs.result),
        data: { notify: true, key }
      });
    }
    const updated = {
      ...child,
      sessionId: obs.result.sessionId ?? child.sessionId,
      costUsd: obs.result.costUsd,
      cacheReadTokens: obs.result.cacheReadTokens,
      status: obs.result.outcome,
      endedAt: now()
    };
    const children = run2.children.map((c, i) => i === index ? updated : c);
    return { run: { ...run2, children }, obs };
  };
  const diffBase = (run2, wt, head, timeoutMs) => {
    const merges = isolatedGit(wt.path, wt.gitDir).text("rev-list", "--min-parents=2", "--max-count=1", `${wt.baseSha}..${head}`).trim();
    if (merges === "") return wt.baseSha;
    try {
      if (!wt.originUrl) throw new Error("no origin URL was recorded when the run was prepared");
      if (!isSafeBranchRef(run2.base)) throw new Error(`${run2.base} is not a safe branch name`);
      const store = at("base.git");
      const env = hardenedGitEnv({ GIT_TERMINAL_PROMPT: "0" });
      const own = (...args) => execFileSync("git", [...HARDENED_GIT_OPTIONS, ...args], {
        // A relative URL resolves as the repository's own fetches resolve it.
        cwd: run2.repoRoot,
        env: { ...env, GIT_DIR: store },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs
      }).trim();
      if (!existsSync(join(store, "HEAD"))) {
        execFileSync("git", [...HARDENED_GIT_OPTIONS, "init", "-q", "--bare", store], {
          env,
          stdio: ["ignore", "pipe", "pipe"]
        });
      }
      const common = git3(run2.repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir");
      writeAtomic2(join(store, "objects", "info", "alternates"), `${join(common, "objects")}
`);
      own(
        "fetch",
        "--no-tags",
        "--quiet",
        "--",
        wt.originUrl,
        `+refs/heads/${run2.base}:refs/heads/base`
      );
      const tip = own("rev-parse", "--verify", "refs/heads/base^{commit}");
      const mergeBase = own("merge-base", head, tip);
      own("merge-base", "--is-ancestor", wt.baseSha, mergeBase);
      return mergeBase;
    } catch (error) {
      const why = errorText3(error).split("\n")[0];
      noteOnce(
        `base-tip:${run2.iteration}:${head}`,
        `the base's tip could not be fetched, so the gate diffs iteration ${run2.iteration} from the commit the run branched from: ${why}`
      );
      return wt.baseSha;
    }
  };
  const rebaseline = (wt, baseline, from, to) => {
    if (from === to) return baseline;
    const g = isolatedGit(wt.path, wt.gitDir);
    const raw = g.text("diff", "--raw", "-z", "--no-abbrev", "--no-renames", from, to).split("\0");
    const entries = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const m = /^:(\d{6}) (\d{6}) [0-9a-f]+ ([0-9a-f]+) /.exec(raw[i] ?? "");
      const path = raw[i + 1];
      if (m?.[1] && m[2] && m[3] && path !== void 0) {
        entries.push({ path, srcMode: m[1], dstMode: m[2], dstSha: m[3] });
      }
    }
    const isProtected = new Set(
      protectedChanges(
        entries.map((e) => e.path),
        protectedPatterns()
      )
    );
    const out = { ...baseline };
    for (const { path, srcMode, dstMode, dstSha } of entries) {
      if (srcMode === GITLINK) delete out[`${path}/`];
      if (dstMode === GITLINK) out[`${path}/`] = NESTED_REPO2;
      if (!isProtected.has(path)) continue;
      delete out[path];
      if (dstMode === "000000" || dstMode === GITLINK) continue;
      const blob = g.bytes("cat-file", "blob", dstSha);
      out[path] = dstMode === "120000" ? `link:${blob.toString("utf8")}` : sha256Bytes(blob);
    }
    return out;
  };
  const parseChecks = (text2, where) => {
    if (text2 === null) return [];
    const doc = (0, import_yaml5.parse)(text2);
    if (doc === null || doc === void 0) return [];
    const parsed = external_exports.array(CheckRuleShape).safeParse(doc);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`${where}: ${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
    }
    return parsed.data;
  };
  const gateSpec = (run2, wt, head) => {
    const findings = [];
    const finding = (id, claim, evidence, expected) => ({
      id: `SPEC-${id}`,
      severity: "blocker",
      category: "spec",
      ...run2.specPath ? { file: run2.specPath } : {},
      claim,
      evidence,
      expected
    });
    const path = run2.specPath;
    if (path === null || !isCanonicalPath(path)) {
      findings.push(
        finding(
          "path",
          `the run's spec path is not a repo-relative path: ${String(path)}`,
          "run.json specPath",
          "a canonical spec path"
        )
      );
      return { text: null, findings };
    }
    let text2 = committedText(wt, head, path);
    if (text2 === null) {
      text2 = specOnDisk(run2);
      findings.push(
        finding(
          "uncommitted",
          `the spec ${path} is not committed on the run branch`,
          `git cat-file blob HEAD:${path} fails`,
          `commit ${path} on the run branch (git add -f ${path} where it is ignored): finalize ships the committed spec`
        )
      );
    }
    if (text2 === null) {
      findings.push(
        finding(
          "unreadable",
          `the spec ${path} cannot be read`,
          "neither HEAD nor the worktree holds it",
          "the sealed spec"
        )
      );
      return { text: text2, findings };
    }
    const { frontmatter, body } = parseFrontmatter(text2.replace(/\r\n?/g, "\n"));
    const block = extractContractBlock(body);
    const stamped = (frontmatter.contract_sha ?? "").trim();
    if (block === null) {
      findings.push(
        finding(
          "contract",
          `the spec ${path} has no spec-contract block`,
          "no ```yaml spec-contract block",
          "the sealed contract"
        )
      );
    } else if (!stamped) {
      findings.push(
        finding(
          "unsealed",
          `the spec ${path} is not sealed`,
          "its front matter has no contract_sha",
          "a sealed spec"
        )
      );
    } else if (contractHash(block) !== stamped) {
      findings.push(
        finding(
          "tampered",
          `the spec ${path} was edited after it was sealed`,
          `contract_sha ${stamped}, the block hashes to ${contractHash(block)}`,
          `the contract as sealed: git checkout <seal commit> -- ${path}`
        )
      );
    }
    return { text: text2, findings };
  };
  const gateWork = (run2) => {
    const config = configFor(run2);
    const wt = worktreeRecord(run2);
    const head = isolatedGit(wt.path, wt.gitDir).text("rev-parse", "--verify", "HEAD^{commit}").trim();
    const spec = gateSpec(run2, wt, head);
    const findings = [...spec.findings];
    let oracles = [];
    const contractFiles = new Set(
      run2.specPath && isCanonicalPath(run2.specPath) ? [run2.specPath] : []
    );
    if (spec.text !== null) {
      try {
        oracles = resolveOracles(spec.text, {
          testOne: config.gates?.test_one,
          stack: unambiguousStackId(wt.path),
          projectRoot: wt.path
        });
      } catch (error) {
        findings.push({
          id: "SPEC-oracles",
          severity: "blocker",
          category: "spec",
          ...run2.specPath ? { file: run2.specPath } : {},
          claim: `the spec's criteria cannot be read: ${errorText3(error)}`,
          evidence: "spec-contract criteria",
          expected: "a contract whose criteria the gate can resolve"
        });
      }
      try {
        readSignals(spec.text, rubric).paths.forEach((raw, i) => {
          const path = posix.normalize(raw).replace(/^\.\//, "");
          if (isCanonicalPath(path)) contractFiles.add(path);
          else {
            findings.push({
              id: `SPEC-file-${i + 1}`,
              severity: "blocker",
              category: "spec",
              claim: `contract file ${JSON.stringify(raw)} is not a repo-relative path`,
              evidence: "spec-contract files",
              expected: "contract files named as git names them"
            });
          }
        });
      } catch {
      }
    }
    const projectChecks = committedText(wt, wt.baseSha, CHECKS_PATH2);
    const checks = [
      ...parseChecks(
        readFileSync(join(pipelineDir, "checks.default.yaml"), "utf8"),
        "checks.default.yaml"
      ),
      // The base commit's rules, not the worktree's: a child cannot loosen the rules it is judged
      // by, and a change it makes to the file is the protected-path blocker.
      ...parseChecks(projectChecks, `${CHECKS_PATH2} at ${wt.baseSha}`)
    ];
    const baseline = readJson(at("protected-baseline.json"), external_exports.record(external_exports.string(), external_exports.string()));
    if (!baseline) throw new Error("no protected baseline; prepare has not run");
    const timeoutMs = config.pipeline.gate_timeout_minutes * 6e4;
    const from = diffBase(run2, wt, head, timeoutMs);
    const planned = stageGates(wt.path, config);
    findings.push(...evidenceFindings(planned));
    const notRun = planned.flatMap(
      (g) => g.missing === void 0 ? [] : [
        {
          id: `G-${g.name}-not-run`,
          severity: "minor",
          category: "gate",
          claim: `${g.name} was not run: \`${g.missing}\` is not on PATH`,
          evidence: `the pre-flight probe for \`${g.command}\`, as verify runs it`,
          expected: `${g.missing} installed, or another command pinned in .marvin/config.json`
        }
      ]
    );
    const report = runGateStage({
      worktree: wt.path,
      baseSha: from,
      gitDir: wt.gitDir,
      gates: planned.flatMap(
        ({ name, command, missing }) => missing === void 0 ? [{ name, command }] : []
      ),
      oracles,
      contractFiles: [...contractFiles],
      sealed: run2.sealed,
      checks,
      exemptPattern: config.pipeline.scope_exempt_pattern,
      protectedPatterns: protectedPatterns(),
      protectedBaseline: rebaseline(wt, baseline, wt.baseSha, from),
      run: runner,
      timeoutMs
    });
    const passed = report.passed && findings.length === 0;
    writeAtomic2(
      at("gated-head.json"),
      `${JSON.stringify({ head, iteration: run2.iteration, passed })}
`
    );
    return {
      run: run2,
      obs: { kind: "gate", report, findings: [...findings, ...reportFindings(report), ...notRun] }
    };
  };
  const specIdentity = (run2) => {
    const text2 = specOnDisk(run2);
    const fm = text2 === null ? {} : parseFrontmatter(text2.replace(/\r\n?/g, "\n")).frontmatter;
    const fromName = run2.specPath ? basename(run2.specPath, ".md").replace(/^\d+-/, "") : void 0;
    const slug = [fm.slug, fromName].find((s) => s !== void 0 && PLAIN_TOKEN2.test(s)) ?? "spec";
    const raw = (fm.tracker ?? fm.tracker_id ?? "").trim();
    const tracker = raw === "" || raw.toLowerCase() === "none" ? null : raw;
    return { slug, tracker };
  };
  const mergeSealed2 = (old, fresh) => {
    const byPath = new Map(old.map((s) => [s.path, s]));
    for (const s of fresh) byPath.set(s.path, s);
    return [...byPath.values()];
  };
  const commitSealed = (run2, wt, sealed, headBefore) => {
    const g = isolatedGit(wt.path, wt.gitDir, { HUSKY: "0", GIT_LITERAL_PATHSPECS: "1" });
    const subject = `test(${specIdentity(run2).slug}): sealed acceptance tests`;
    const paths = sealed.map((s) => s.path);
    const headNow = () => g.text("rev-parse", "--verify", "HEAD^{commit}").trim();
    const refuseStrays = (commit) => {
      const strays = g.text("diff-tree", "-r", "--no-commit-id", "--name-only", "--no-renames", "-z", commit).split("\0").filter((p) => p !== "" && !paths.includes(p));
      if (strays.length > 0) throw new Error(`the seal commit also holds ${strays.join(", ")}`);
    };
    let head = headNow();
    if (head !== headBefore) {
      const parent = g.text("rev-parse", "--verify", `${head}^`).trim();
      const message = g.text("log", "-1", "--format=%s", head).trim();
      if (parent !== headBefore || message !== subject) {
        throw new Error(`HEAD moved from ${headBefore} to ${head} while the tests were sealed`);
      }
      refuseStrays(head);
    } else {
      g.text("add", "--", ...paths);
      const staged = g.text("diff", "--cached", "--name-only", "-z", "--", ...paths).split("\0").filter(Boolean);
      if (staged.length > 0) {
        g.text("commit", "-q", "-m", subject, "--only", "--", ...paths);
        head = headNow();
        refuseStrays(head);
      }
    }
    for (const s of sealed) {
      if (sha256Bytes(g.bytes("cat-file", "blob", `${head}:${s.path}`)) !== s.sha256) {
        throw new Error(`${s.path} as committed in ${head} is not the file that was sealed`);
      }
    }
    return head;
  };
  const sealWork = (run2, data, step2) => {
    const config = configFor(run2);
    const wt = worktreeRecord(run2);
    const path = at(`seal-${step2.ref}.json`);
    let marker = readJson(path, SealMarker);
    if (!marker) {
      const tests = data?.tests;
      if (!Array.isArray(tests)) throw new Error("seal work without the test-author's tests");
      const headBefore = isolatedGit(wt.path, wt.gitDir).text("rev-parse", "--verify", "HEAD^{commit}").trim();
      const template = config.gates?.test_one;
      if (!template) {
        throw new Error(
          `sealing needs gates.test_one in .marvin/config.json as committed at ${run2.base}: the red run uses it`
        );
      }
      const verdict = sealAuthoredTests({
        worktree: wt.path,
        tests,
        testPathPattern: config.pipeline.test_path_pattern,
        testOne: template,
        run: runner,
        timeoutMs: config.pipeline.gate_timeout_minutes * 6e4,
        ...isReseal(run2) ? { base: { sha: wt.baseSha, gitDir: wt.gitDir } } : {}
      });
      if (!verdict.ok) {
        const obs2 = { kind: "seal", ok: false, reasons: verdict.reasons, sealed: [] };
        return { run: run2, obs: obs2 };
      }
      marker = { phase: "sealed", headBefore, sealed: verdict.sealed };
      writeAtomic2(path, `${JSON.stringify(marker)}
`);
    }
    if (marker.phase === "sealed") {
      const commit = commitSealed(run2, wt, marker.sealed, marker.headBefore);
      marker = { ...marker, phase: "committed", commit };
      writeAtomic2(path, `${JSON.stringify(marker)}
`);
    }
    writeSealManifest(runDir, mergeSealed2(run2.sealed, marker.sealed));
    const obs = { kind: "seal", ok: true, reasons: [], sealed: marker.sealed };
    return { run: run2, obs };
  };
  const ghEnv = (config) => {
    const command = config.pipeline.github.token_command;
    return command ? { ...process.env, GH_TOKEN: execSync(command, { encoding: "utf8" }).trim() } : { ...process.env };
  };
  const fakeCi = () => {
    const value = process.env.MARVIN_PIPELINE_FAKE_CI;
    if (!value) return null;
    if (!CI_STATES.includes(value)) {
      throw new Error(`MARVIN_PIPELINE_FAKE_CI must be one of ${CI_STATES.join(", ")}: ${value}`);
    }
    return value;
  };
  const ciWork = async (run2) => {
    const fake = fakeCi();
    if (fake) {
      return { run: run2, obs: { kind: "ci", state: fake, failing: fake === "red" ? ["fake-ci"] : [] } };
    }
    const config = configFor(run2);
    const poll = { stage: run2.stage, ciSince: run2.ciSince };
    const last = readJson(at("ci-poll.json"), CiPoll);
    if (last?.stage === poll.stage && last.ciSince === poll.ciSince) {
      await setTimeout(config.pipeline.ci_poll_seconds * 1e3, void 0, { signal: deps.signal });
    }
    writeAtomic2(at("ci-poll.json"), `${JSON.stringify(poll)}
`);
    if (!run2.prUrl) throw new Error("waiting for CI with no pull request");
    const wt = worktreeRecord(run2);
    const expected = isolatedGit(wt.path, wt.gitDir).text("rev-parse", "--verify", "HEAD^{commit}").trim();
    const pending = { kind: "ci", state: "pending", failing: [] };
    try {
      const { pr, runs } = fetchCi({
        worktree: wt.path,
        prUrl: run2.prUrl,
        tokenCommand: config.pipeline.github.token_command
      });
      if (pr.state === "OPEN" && pr.headRefOid !== expected) return { run: run2, obs: pending };
      const since = run2.ciSince === null ? Date.now() : Date.parse(run2.ciSince);
      const { state, failing } = classifyCi({
        pr,
        runs,
        minutesSincePush: Math.max(0, (Date.now() - since) / 6e4),
        noCiAfterMinutes: config.pipeline.no_ci_minutes
      });
      return { run: run2, obs: { kind: "ci", state, failing } };
    } catch (error) {
      const text2 = `CI state unavailable, read as pending: ${errorText3(error).split("\n")[0]}`;
      const wait2 = `ci-unavailable:${run2.stage}:${String(run2.ciSince)}`;
      if (readEventsTolerant(runDir).some((e) => e.data?.ref === wait2)) note(text2);
      else note(text2, { notify: true, ref: wait2 });
      return { run: run2, obs: pending };
    }
  };
  const finalizeWork = (run2, data) => {
    const config = configFor(run2);
    const wt = worktreeRecord(run2);
    const gated = readJson(at("gated-head.json"), GatedHead);
    const ships = run2.prUrl !== null && run2.haltReason === null;
    if (ships && (!gated?.passed || !FULL_SHA4.test(gated.head))) {
      throw new Error("finalize needs the commit a passing gate approved, and none is recorded");
    }
    finalizeRun({
      run: run2,
      runDir,
      worktree: wt.path,
      gitDir: wt.gitDir,
      expectedHead: ships && gated ? gated.head : "",
      retro: data?.retro ?? null,
      events: readEventsTolerant(runDir),
      exposedLessons: readJson(at("lessons-exposed.json"), external_exports.array(external_exports.string())) ?? [],
      formatCommand: config.pipeline.format_command,
      runCommand: runner
    });
    return { run: run2, obs: { kind: "finalized" } };
  };
  const markReady = (run2, step2) => {
    if (fakeCi()) {
      noteOnce(step2.ref, "fake CI: the pull request was not marked ready");
      return { run: run2 };
    }
    if (!run2.prUrl) throw new Error("mark_ready with no pull request");
    const config = configFor(run2);
    const wt = worktreeRecord(run2);
    const env = ghEnv(config);
    const gh = (...args) => execFileSync("gh", args, {
      cwd: wt.path,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const view = external_exports.object({ isDraft: external_exports.boolean() }).parse(JSON.parse(gh("pr", "view", run2.prUrl, "--json", "isDraft")));
    if (view.isDraft) gh("pr", "ready", run2.prUrl);
    return { run: run2 };
  };
  const renameBranch = (run2, step2) => {
    const config = configFor(run2);
    const wt = worktreeRecord(run2);
    const { slug, tracker } = specIdentity(run2);
    const target = branchName(config.pipeline.branch_template, {
      tracker: tracker ?? config.pipeline.tracker_default,
      slug
    });
    const fallback = `${target}-${run2.id}`;
    for (const name of [target, fallback]) {
      if (!isSafeBranchRef(name)) throw new Error(`the run branch name is not a safe ref: ${name}`);
    }
    const current = git3(wt.path, "symbolic-ref", "--short", "HEAD");
    if (current === target || current === fallback) return { run: { ...run2, branch: current } };
    if (current !== run2.branch) {
      throw new Error(`the worktree is on ${current}, not the run branch ${String(run2.branch)}`);
    }
    try {
      renameRunBranch(wt.path, target);
      return { run: { ...run2, branch: target } };
    } catch (error) {
      if (!/already exists/.test(errorText3(error))) throw error;
      renameRunBranch(wt.path, fallback);
      noteOnce(step2.ref, `branch ${target} is taken; the run branch is ${fallback}`);
      return { run: { ...run2, branch: fallback } };
    }
  };
  const work = async (run2, kind, data, step2) => {
    switch (kind) {
      case "gate":
        return gateWork(run2);
      case "seal":
        return sealWork(run2, data, step2);
      case "ci":
        return ciWork(run2);
      case "finalize":
        return finalizeWork(run2, data);
      case "mark_ready":
        return markReady(run2, step2);
      case "rename_branch":
        return renameBranch(run2, step2);
      case "snapshot": {
        if (run2.worktree === null) throw new Error("snapshot with no worktree");
        writeAtomic2(at("snapshot.txt"), snapshotTree(run2.worktree));
        return { run: run2 };
      }
    }
  };
  const fixtures = process.env.MARVIN_PIPELINE_JUDGE === "fixtures";
  const deps = {
    rubric,
    pollMs,
    judge: fixtures ? "fixtures" : "files",
    ...fixtures && process.env.MARVIN_PIPELINE_FIXTURES ? { fixturesDir: process.env.MARVIN_PIPELINE_FIXTURES } : {},
    ...o.signal ? { signal: o.signal } : {},
    prepare,
    spawnChild,
    waitChild,
    work
  };
  return deps;
}

// src/pipeline/cli.ts
var SELF = fileURLToPath(import.meta.url);
var PLUGIN_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
var AWAIT_DEADLINE_MIN = 110;
var AWAIT_POLL_MS = 2e3;
function flag(flags, name) {
  const value = flags[name];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`--${name} is required`);
  return value;
}
function optional(flags, name) {
  const value = flags[name];
  return typeof value === "string" && value.trim() !== "" ? value : void 0;
}
function positive(flags, name) {
  const raw = optional(flags, name);
  if (raw === void 0) return void 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`);
  return n;
}
var print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}
`);
function runDirOf(flags) {
  const dir = resolve(flag(flags, "run"));
  if (!existsSync(join(dir, "run.json"))) throw new Error(`no run at ${dir}`);
  return dir;
}
function rubricFor(pluginRoot, repoRoot) {
  const defaults = readFileSync(join(pluginRoot, "pipeline", "rubric.default.yaml"), "utf8");
  const projectFile = join(repoRoot, ".marvin", "pipeline", "rubric.yaml");
  const project = existsSync(projectFile) ? readFileSync(projectFile, "utf8") : null;
  return loadRubric(defaults, project);
}
function init(flags) {
  const repoRoot = resolve(flag(flags, "repo"));
  const stageA = flag(flags, "stage-a");
  if (!TIERS.includes(stageA)) {
    throw new Error(`--stage-a must be one of ${TIERS.join(", ")}, not ${stageA}`);
  }
  assertOrchestratorName(flag(flags, "orch"));
  const now = /* @__PURE__ */ new Date();
  const id = newRunId(now);
  const runDir = runDirFor(repoRoot, id);
  if (existsSync(runDir)) throw new Error(`run ${id} already exists at ${runDir}`);
  const run2 = initRun({
    id,
    repoRoot,
    base: flag(flags, "base"),
    lang: flag(flags, "lang"),
    orchestratorName: flag(flags, "orch"),
    task: readFileSync(flag(flags, "task-file"), "utf8"),
    taskEnglish: readFileSync(flag(flags, "task-en-file"), "utf8"),
    stageA,
    now
  });
  mkdirSync(runDir, { recursive: true });
  saveRun(runDir, run2);
  print({ runId: id, runDir });
}
var START_WAIT_MS = 15e3;
async function start(flags) {
  const runDir = runDirOf(flags);
  if (engineAlive(runDir)) throw new Error(`an engine already holds ${runDir}`);
  const logFile = join(runDir, "engine.log");
  const log = openSync(logFile, "a");
  let pid;
  let exited = false;
  try {
    const child = spawn(process.execPath, [SELF, "engine", "--run", runDir], {
      detached: true,
      stdio: ["ignore", log, log],
      env: process.env
    });
    child.once("exit", () => {
      exited = true;
    });
    child.unref();
    pid = child.pid;
  } finally {
    closeSync(log);
  }
  if (pid === void 0) throw new Error("the engine could not be launched");
  const deadline = Date.now() + START_WAIT_MS;
  for (; ; ) {
    if (lockHolderPid(runDir) === pid) break;
    if (exited) {
      const tail = readFileSync(logFile, "utf8").trim().split("\n").slice(-3).join(" | ");
      throw new Error(
        `the engine exited before it took the run: ${tail || "(engine.log is empty)"}`
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the engine (pid ${pid}) did not take the run within ${START_WAIT_MS / 1e3} s; see ${logFile}`
      );
    }
    await setTimeout(50);
  }
  print({ pid });
}
async function engine(flags) {
  const runDir = runDirOf(flags);
  const run2 = loadRun(runDir);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const deps = createRuntime({
    runDir,
    pluginRoot: PLUGIN_ROOT,
    rubric: rubricFor(PLUGIN_ROOT, run2.repoRoot),
    signal: controller.signal
  });
  const done = await runEngine(runDir, deps);
  print({ id: done.id, stage: done.stage, haltReason: done.haltReason, prUrl: done.prUrl });
}
function attach(flags) {
  const runDir = runDirOf(flags);
  const name = flag(flags, "orch");
  writeOrchestrator(runDir, name);
  print({ runDir, orchestrator: name });
}
async function awaitCommand(flags) {
  const runDir = runDirOf(flags);
  const deadlineMin = positive(flags, "deadline-min") ?? AWAIT_DEADLINE_MIN;
  const repeatSec = positive(flags, "repeat-sec");
  const lines = await awaitWork(runDir, {
    pollMs: AWAIT_POLL_MS,
    deadlineMs: deadlineMin * 6e4,
    ...repeatSec !== void 0 ? { repeatMs: repeatSec * 1e3 } : {}
  });
  process.stdout.write(`${lines.join("\n")}
`);
}
var ANSWERERS = ["orchestrator", "user"];
function judge(flags) {
  const runDir = runDirOf(flags);
  const id = flag(flags, "id");
  const by = optional(flags, "answered-by");
  if (by !== void 0 && !ANSWERERS.includes(by)) {
    throw new Error(`--answered-by must be one of ${ANSWERERS.join(", ")}, not ${by}`);
  }
  const run2 = loadRun(runDir);
  const raw = JSON.parse(readFileSync(flag(flags, "answer-file"), "utf8"));
  const answer = answerJudgment(runDir, id, raw, {
    rubric: rubricFor(PLUGIN_ROOT, run2.repoRoot)
  });
  if (by !== void 0) {
    appendEvent(runDir, {
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      kind: "answer",
      actor: "orchestrator",
      text: `${id} answered by ${by}`,
      data: { id, answeredBy: by }
    });
  }
  print({ id, answer, ...by !== void 0 ? { answeredBy: by } : {} });
}
function status(flags) {
  const runDir = runDirOf(flags);
  const run2 = loadRun(runDir);
  print({
    ...run2,
    runDir,
    orchestrator: orchestratorOf(runDir, run2),
    engineAlive: engineAlive(runDir)
  });
}
function list(flags) {
  const root = stateRoot();
  const repo = optional(flags, "repo");
  const repoRoot = repo === void 0 ? void 0 : resolve(repo);
  const groups = repoRoot === void 0 ? subdirs(root) : [basename(repoRoot)];
  const rows = groups.flatMap(
    (group) => subdirs(join(root, group)).flatMap((id) => {
      const runDir = join(root, group, id);
      let run2;
      try {
        run2 = loadRun(runDir);
      } catch {
        return [];
      }
      if (repoRoot !== void 0 && !sameDir(run2.repoRoot, repoRoot)) return [];
      return [
        {
          id: run2.id,
          runDir,
          repoRoot: run2.repoRoot,
          stage: run2.stage,
          haltReason: run2.haltReason,
          prUrl: run2.prUrl,
          orchestrator: orchestratorOf(runDir, run2),
          engineAlive: engineAlive(runDir),
          updatedAt: run2.updatedAt
        }
      ];
    })
  );
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  print(rows);
}
function subdirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
function sameDir(a, b) {
  const physical = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return physical(a) === physical(b);
}
function assess(flags) {
  const specPath = resolve(flag(flags, "spec"));
  const repoRoot = resolve(optional(flags, "repo") ?? process.cwd());
  const rubric = rubricFor(PLUGIN_ROOT, repoRoot);
  const signals = readSignals(readFileSync(specPath, "utf8"), rubric);
  const { tier, reasons } = tierFor(signals, rubric);
  const assignments = Object.fromEntries(
    ROLES.map((role) => {
      const a = assignmentFor(tier, role, 0, rubric);
      return [role, a === "skip" ? "skip" : `${a.model}/${a.effort}`];
    })
  );
  print({ spec: specPath, tier, reasons, signals, assignments });
}
var COMMANDS = {
  init,
  start,
  engine,
  attach,
  await: awaitCommand,
  judge,
  status,
  list,
  assess
};
var OPTIONS = {
  repo: { type: "string" },
  base: { type: "string" },
  lang: { type: "string" },
  orch: { type: "string" },
  "stage-a": { type: "string" },
  "task-file": { type: "string" },
  "task-en-file": { type: "string" },
  run: { type: "string" },
  id: { type: "string" },
  "answer-file": { type: "string" },
  "answered-by": { type: "string" },
  "deadline-min": { type: "string" },
  "repeat-sec": { type: "string" },
  spec: { type: "string" }
};
async function main(argv) {
  const [command, ...rest] = argv;
  const run2 = command === void 0 ? void 0 : COMMANDS[command];
  if (run2 === void 0) {
    process.stderr.write(`usage: marvin-pipe <${Object.keys(COMMANDS).join("|")}> [--flags]
`);
    return 1;
  }
  try {
    const { values } = parseArgs({ args: [...rest], options: OPTIONS, strict: true });
    await run2(values);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`marvin-pipe ${command}: ${message}
`);
    return 1;
  }
}
if (process.argv[1] !== void 0 && resolve(process.argv[1]) === SELF) {
  process.exitCode = await main(process.argv.slice(2));
}

export { main, rubricFor };
