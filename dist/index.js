
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ComponentAnalyzer = void 0;
const fs = __importStar(__nccwpck_require__(1943));
const path = __importStar(__nccwpck_require__(6928));
const parser_1 = __nccwpck_require__(5429);
const traverse_1 = __importDefault(__nccwpck_require__(148));
const t = __importStar(__nccwpck_require__(6535));
const component_path_resolver_1 = __nccwpck_require__(1682);
class ComponentAnalyzer {
    constructor(options, perf) {
        this.componentRegistry = new Map();
        this.importToComponentMap = new Map();
        this.processingComponentStack = new Set(); // To prevent circular references
        this.resolver = new component_path_resolver_1.ComponentPathResolver();
        this.options = options;
        this.perf = perf;
    }
    async analyzeFile(filePath) {
        var _a;
        const start = Date.now();
        try {
            const content = await fs.readFile(filePath, 'utf8');
            if (!/\.(jsx|tsx)$/.test(filePath))
                return null;
            const { component, timings } = await this.extractComponentInfo(content, filePath);
            timings.total = Date.now() - start;
            (_a = this.perf) === null || _a === void 0 ? void 0 : _a.record(filePath, timings);
            return component;
        }
        catch (e) {
            console.error(`[ZemDomu] Error analyzing file ${filePath}:`, e);
            return null;
        }
    }
    async extractComponentInfo(content, filePath) {
        var _a, _b;
        const timings = {};
        let t0 = Date.now();
        const ast = (0, parser_1.parse)(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
        timings.parse = Date.now() - t0;
        const componentName = path.basename(filePath, path.extname(filePath));
        const componentDef = {
            name: componentName,
            filePath,
            issues: new Map(),
            usesComponents: [],
            headings: []
        };
        // Track imported components
        const importedComponents = new Map();
        // Collect imports
        t0 = Date.now();
        (0, traverse_1.default)(ast, {
            ImportDeclaration(path) {
                const source = path.node.source.value;
                path.node.specifiers.forEach(spec => {
                    if (t.isImportSpecifier(spec) || t.isImportDefaultSpecifier(spec)) {
                        const name = spec.local.name;
                        if (/^[A-Z]/.test(name)) {
                            importedComponents.set(name, source);
                        }
                    }
                });
            }
        });
        timings.collectImports = Date.now() - t0;
        // Collect JSX usages and headings
        t0 = Date.now();
        (0, traverse_1.default)(ast, {
            JSXElement(path) {
                var _a, _b;
                const elt = path.node.openingElement.name;
                if (t.isJSXIdentifier(elt)) {
                    const name = elt.name;
                    const tag = name.toLowerCase();
                    // Record headings
                    if (/^h[1-6]$/.test(tag)) {
                        const level = parseInt(tag.charAt(1), 10);
                        const loc = (_a = elt.loc) === null || _a === void 0 ? void 0 : _a.start;
                        if (loc) {
                            componentDef.headings.push({
                                level,
                                line: loc.line - 1,
                                column: loc.column,
                                filePath
                            });
                        }
                    }
                    // Record component usage (only for capitalized components)
                    if (/^[A-Z]/.test(name)) {
                        const existingRef = componentDef.usesComponents.find(c => c.name === name);
                        const loc = (_b = elt.loc) === null || _b === void 0 ? void 0 : _b.start;
                        const location = loc ? { line: loc.line - 1, column: loc.column } : { line: 0, column: 0 };
                        if (existingRef) {
                            // Add usage location to existing reference
                            existingRef.usageLocations.push(location);
                        }
                        else {
                            // Create new component reference
                            const rawImportPath = importedComponents.get(name) || null;
                            componentDef.usesComponents.push({
                                name,
                                path: null, // Will be resolved later
                                rawImportPath,
                                sourceLocation: location,
                                usageLocations: [location]
                            });
                        }
                    }
                }
            }
        });
        timings.jsxCollect = Date.now() - t0;
        // Store import mappings for this file
        this.importToComponentMap.set(filePath, importedComponents);
        // Resolve import paths
        t0 = Date.now();
        for (const ref of componentDef.usesComponents) {
            if (ref.rawImportPath) {
                const t1 = Date.now();
                ref.path = await this.resolveComponentPath(ref.rawImportPath, filePath);
                timings[`resolve:${ref.rawImportPath}`] = Date.now() - t1;
            }
        }
        timings.resolvePaths = Date.now() - t0;
        // Check for heading order issues within this component
        t0 = Date.now();
        if ((_a = this.options.rules) === null || _a === void 0 ? void 0 : _a.enforceHeadingOrder) {
            let lastHeadingLevel = 0;
            const sortedHeadings = [...componentDef.headings].sort((a, b) => {
                if (a.line !== b.line)
                    return a.line - b.line;
                return a.column - b.column;
            });
            for (const heading of sortedHeadings) {
                if (lastHeadingLevel && heading.level > lastHeadingLevel + 1) {
                    componentDef.issues.set('enforceHeadingOrder', [
                        ...(componentDef.issues.get('enforceHeadingOrder') || []),
                        {
                            line: heading.line,
                            column: heading.column,
                            message: `Heading level skipped: <h${heading.level}> after <h${lastHeadingLevel}>`,
                            rule: 'enforceHeadingOrder'
                        }
                    ]);
                }
                lastHeadingLevel = heading.level;
            }
        }
        // Synthetic single-H1 issues
        if ((_b = this.options.rules) === null || _b === void 0 ? void 0 : _b.singleH1) {
            const h1Results = componentDef.headings
                .filter(h => h.level === 1)
                .map(h => ({ line: h.line, column: h.column, message: '<h1>', rule: 'singleH1' }));
            if (h1Results.length > 0) {
                componentDef.issues.set('singleH1', h1Results);
            }
        }
        timings.headingAnalysis = Date.now() - t0;
        // Register component
        this.componentRegistry.set(filePath, componentDef);
        return { component: componentDef, timings };
    }
    async resolveComponentPath(importPath, currentPath) {
        return this.resolver.resolve(importPath, currentPath);
    }
    registerComponent(component, issues) {
        for (const issue of issues) {
            const rule = issue.rule || this.getRuleType(issue.message);
            if (!component.issues.has(rule))
                component.issues.set(rule, []);
            component.issues.get(rule).push(issue);
        }
        this.componentRegistry.set(component.filePath, component);
    }
    getRuleType(msg) {
        if (msg.includes('<h1>'))
            return 'singleH1';
        if (msg.includes('Heading level'))
            return 'enforceHeadingOrder';
        if (msg.includes('<section>'))
            return 'requireSectionHeading';
        if (msg.includes('<img>'))
            return 'requireAltText';
        if (msg.includes('missing title attribute'))
            return 'requireIframeTitle';
        if (msg.includes('missing alt attribute') && msg.includes('input type="image"'))
            return 'requireImageInputAlt';
        if (msg.includes('<html>'))
            return 'requireHtmlLang';
        if (msg.includes('<button>'))
            return 'requireButtonText';
        if (msg.includes('Form control'))
            return 'requireLabelForFormControls';
        if (msg.includes('<li>'))
            return 'enforceListNesting';
        if (msg.includes('<a>'))
            return msg.includes('href') ? 'requireHrefOnAnchors' : 'requireLinkText';
        if (msg.includes('<table>'))
            return 'requireTableCaption';
        if (msg.includes('should not be empty'))
            return 'preventEmptyInlineTags';
        return 'other';
    }
    analyzeComponentTree() {
        var _a;
        const results = [];
        const cross = (_a = this.options.crossComponentAnalysis) !== null && _a !== void 0 ? _a : true;
        const rules = this.options.rules || {};
        if (!cross)
            return results;
        if (rules.singleH1)
            this.findCrossComponentH1Issues(results);
        if (rules.enforceHeadingOrder)
            this.findCrossComponentHeadingOrderIssues(results);
        return results;
    }
    findCrossComponentH1Issues(results) {
        var _a;
        const entryPoints = this.findEntryPoints();
        for (const entry of entryPoints) {
            const comps = this.findComponentsWithRule(entry, 'singleH1');
            if (comps.length > 1) {
                for (let i = 1; i < comps.length; i++) {
                    const comp = comps[i];
                    if (!comp || !comp.name) {
                        console.error('[ZemDomu] Missing component or name during cross-component analysis', comp);
                        continue;
                    }
                    const ref = this.findReferenceForComp(entry, comp.filePath);
                    if (ref) {
                        // Use first JSX usage location instead of import location
                        const location = ref.usageLocations[0] || ref.sourceLocation;
                        results.push({
                            filePath: entry.filePath,
                            line: location.line,
                            column: location.column,
                            message: `Multiple <h1> tags: component '${comp.name}' brings an extra <h1>. Use a lower-level heading.`,
                            rule: 'singleH1'
                        });
                    }
                    else {
                        const issue = (_a = comp.issues.get('singleH1')) === null || _a === void 0 ? void 0 : _a[0];
                        if (issue) {
                            results.push({
                                filePath: comp.filePath,
                                line: issue.line,
                                column: issue.column,
                                message: `Multiple <h1> across components - consider using lower-level headings.`,
                                rule: 'singleH1'
                            });
                        }
                    }
                }
            }
        }
    }
    findReferenceForComp(root, targetPath) {
        for (const ref of root.usesComponents) {
            if (ref.path === targetPath)
                return ref;
        }
        for (const ref of root.usesComponents) {
            if (ref.path && this.componentRegistry.has(ref.path)) {
                const nested = this.findReferenceForComp(this.componentRegistry.get(ref.path), targetPath);
                if (nested)
                    return ref;
            }
        }
        return null;
    }
    /**
     * Improved implementation to find heading order issues across components
     */
    findCrossComponentHeadingOrderIssues(results) {
        const entryPoints = this.findEntryPoints();
        for (const entry of entryPoints) {
            // Process each entry point as a document root
            this.processingComponentStack.clear();
            this.analyzeHeadingHierarchy(entry, results);
        }
    }
    /**
     * Collects all headings from a component and its children in document order
     * and checks for heading level issues
     */
    analyzeHeadingHierarchy(component, results) {
        var _a, _b, _c;
        if (this.processingComponentStack.has(component.filePath)) {
            // Avoid circular references
            return;
        }
        this.processingComponentStack.add(component.filePath);
        // Build a flattened view of all headings in document order
        const allHeadings = this.collectHeadingsInDocumentOrder(component);
        // Check for heading level issues
        let lastLevel = 0;
        for (const heading of allHeadings) {
            if (lastLevel > 0 && heading.heading.level > lastLevel + 1) {
                // We found a heading level skip
                results.push({
                    filePath: ((_a = heading.usageLocation) === null || _a === void 0 ? void 0 : _a.filePath) || heading.heading.filePath,
                    line: ((_b = heading.usageLocation) === null || _b === void 0 ? void 0 : _b.line) || heading.heading.line,
                    column: ((_c = heading.usageLocation) === null || _c === void 0 ? void 0 : _c.column) || heading.heading.column,
                    message: `Cross-component heading level skipped: <h${heading.heading.level}> after <h${lastLevel}>`,
                    rule: 'enforceHeadingOrder'
                });
            }
            lastLevel = heading.heading.level;
        }
        this.processingComponentStack.delete(component.filePath);
    }
    /**
     * Collects all headings from a component and its children in document order
     */
    collectHeadingsInDocumentOrder(component) {
        // Sort headings within this component by line/column
        const localHeadings = [...component.headings].sort((a, b) => {
            if (a.line !== b.line)
                return a.line - b.line;
            return a.column - b.column;
        }).map(h => ({
            heading: h,
            usageLocation: null
        }));
        // Sort child components by their usage location
        const childComponents = component.usesComponents
            .filter(ref => ref.path && this.componentRegistry.has(ref.path))
            .sort((a, b) => {
            const aLoc = a.usageLocations[0] || a.sourceLocation;
            const bLoc = b.usageLocations[0] || b.sourceLocation;
            if (aLoc.line !== bLoc.line)
                return aLoc.line - bLoc.line;
            return aLoc.column - bLoc.column;
        });
        // Merge headings and child component headings in document order
        const allHeadings = [];
        let headingIndex = 0;
        let childIndex = 0;
        // This merges the local headings with child component headings
        // based on their position in the document
        while (headingIndex < localHeadings.length || childIndex < childComponents.length) {
            if (headingIndex >= localHeadings.length) {
                // No more local headings, process remaining children
                const childRef = childComponents[childIndex++];
                if (childRef.path && this.componentRegistry.has(childRef.path) && !this.processingComponentStack.has(childRef.path)) {
                    const childComponent = this.componentRegistry.get(childRef.path);
                    const usageLoc = childRef.usageLocations[0] || childRef.sourceLocation;
                    const usageLocation = {
                        filePath: component.filePath,
                        line: usageLoc.line,
                        column: usageLoc.column
                    };
                    this.processingComponentStack.add(childRef.path);
                    const childHeadings = this.collectHeadingsInDocumentOrder(childComponent)
                        .map(h => ({
                        heading: h.heading,
                        usageLocation: h.usageLocation || usageLocation
                    }));
                    this.processingComponentStack.delete(childRef.path);
                    allHeadings.push(...childHeadings);
                }
            }
            else if (childIndex >= childComponents.length) {
                // No more children, add remaining local headings
                allHeadings.push(localHeadings[headingIndex++]);
            }
            else {
                // Compare positions to decide whether to add a local heading or process a child
                const nextHeading = localHeadings[headingIndex];
                const nextChild = childComponents[childIndex];
                const childLoc = nextChild.usageLocations[0] || nextChild.sourceLocation;
                if (nextHeading.heading.line < childLoc.line ||
                    (nextHeading.heading.line === childLoc.line && nextHeading.heading.column < childLoc.column)) {
                    // Local heading comes first
                    allHeadings.push(nextHeading);
                    headingIndex++;
                }
                else {
                    // Child component comes first
                    childIndex++;
                    if (nextChild.path && this.componentRegistry.has(nextChild.path) && !this.processingComponentStack.has(nextChild.path)) {
                        const childComponent = this.componentRegistry.get(nextChild.path);
                        const usageLocation = {
                            filePath: component.filePath,
                            line: childLoc.line,
                            column: childLoc.column
                        };
                        this.processingComponentStack.add(nextChild.path);
                        const childHeadings = this.collectHeadingsInDocumentOrder(childComponent)
                            .map(h => ({
                            heading: h.heading,
                            usageLocation: h.usageLocation || usageLocation
                        }));
                        this.processingComponentStack.delete(nextChild.path);
                        allHeadings.push(...childHeadings);
                    }
                }
            }
        }
        return allHeadings;
    }
    findEntryPoints() {
        const all = Array.from(this.componentRegistry.values());
        const imported = new Set();
        all.forEach(c => c.usesComponents.forEach(r => r.path && imported.add(r.path)));
        return all.filter(c => !imported.has(c.filePath));
    }
    findComponentsWithRule(root, rule) {
        const res = [];
        const visited = new Set();
        const dfs = (c) => {
            if (visited.has(c.filePath))
                return;
            visited.add(c.filePath);
            if (c.issues.has(rule))
                res.push(c);
            c.usesComponents.forEach(r => r.path && this.componentRegistry.has(r.path) && dfs(this.componentRegistry.get(r.path)));
        };
        dfs(root);
        return res;
    }
}
exports.ComponentAnalyzer = ComponentAnalyzer;

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.lint = lint;
const simpleHtmlParser_1 = __nccwpck_require__(7790);
const parser_1 = __nccwpck_require__(5429);
const traverse_1 = __importDefault(__nccwpck_require__(148));
const requireAltText_1 = __importDefault(__nccwpck_require__(2983));
const requireSectionHeading_1 = __importDefault(__nccwpck_require__(9996));
const enforceHeadingOrder_1 = __importDefault(__nccwpck_require__(5344));
const singleH1_1 = __importDefault(__nccwpck_require__(7545));
const requireLabelForFormControls_1 = __importDefault(__nccwpck_require__(7774));
const enforceListNesting_1 = __importDefault(__nccwpck_require__(5774));
const requireLinkText_1 = __importDefault(__nccwpck_require__(7928));
const requireTableCaption_1 = __importDefault(__nccwpck_require__(1701));
const preventEmptyInlineTags_1 = __importDefault(__nccwpck_require__(5409));
const requireHrefOnAnchors_1 = __importDefault(__nccwpck_require__(7845));
const requireButtonText_1 = __importDefault(__nccwpck_require__(3388));
const requireIframeTitle_1 = __importDefault(__nccwpck_require__(3733));
const requireHtmlLang_1 = __importDefault(__nccwpck_require__(3258));
const requireImageInputAlt_1 = __importDefault(__nccwpck_require__(1853));
const requireNavLinks_1 = __importDefault(__nccwpck_require__(893));
const uniqueIds_1 = __importDefault(__nccwpck_require__(191));
const noTabindexGreaterThanZero_1 = __importDefault(__nccwpck_require__(745));
const builtInRules = {
    requireSectionHeading: requireSectionHeading_1.default,
    enforceHeadingOrder: enforceHeadingOrder_1.default,
    singleH1: singleH1_1.default,
    requireAltText: requireAltText_1.default,
    requireLabelForFormControls: requireLabelForFormControls_1.default,
    enforceListNesting: enforceListNesting_1.default,
    requireLinkText: requireLinkText_1.default,
    requireTableCaption: requireTableCaption_1.default,
    preventEmptyInlineTags: preventEmptyInlineTags_1.default,
    requireHrefOnAnchors: requireHrefOnAnchors_1.default,
    requireButtonText: requireButtonText_1.default,
    requireIframeTitle: requireIframeTitle_1.default,
    requireHtmlLang: requireHtmlLang_1.default,
    requireImageInputAlt: requireImageInputAlt_1.default,
    requireNavLinks: requireNavLinks_1.default,
    uniqueIds: uniqueIds_1.default,
    noTabindexGreaterThanZero: noTabindexGreaterThanZero_1.default,
};
const defaultOptions = {
    rules: {
        requireSectionHeading: true,
        enforceHeadingOrder: true,
        singleH1: true,
        requireAltText: true,
        requireLabelForFormControls: true,
        enforceListNesting: true,
        requireLinkText: true,
        requireTableCaption: true,
        preventEmptyInlineTags: true,
        requireHrefOnAnchors: true,
        requireButtonText: true,
        requireIframeTitle: true,
        requireHtmlLang: true,
        requireImageInputAlt: true,
        requireNavLinks: true,
        uniqueIds: true,
        noTabindexGreaterThanZero: true,
    },
    customRules: [],
};
/**
 * Lint HTML/JSX/TSX content.
 */
function lint(content, options = defaultOptions) {
    var _a;
    const opts = {
        rules: { ...defaultOptions.rules, ...(options.rules || {}) },
        customRules: (_a = options.customRules) !== null && _a !== void 0 ? _a : defaultOptions.customRules,
    };
    const results = [];
    const activeRules = [];
    for (const name in opts.rules) {
        const enabled = opts.rules[name];
        if (enabled && builtInRules[name]) {
            activeRules.push(builtInRules[name]());
        }
    }
    if (opts.customRules)
        activeRules.push(...opts.customRules);
    activeRules.forEach(r => r.init && r.init());
    let ast = null;
    try {
        ast = (0, parser_1.parse)(content, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx'],
        });
    }
    catch {
        ast = null;
    }
    if (ast) {
        (0, traverse_1.default)(ast, {
            JSXElement: {
                enter(path) {
                    var _a;
                    for (const rule of activeRules) {
                        if (rule.enterJsx) {
                            try {
                                results.push(...rule.enterJsx(path));
                            }
                            catch (e) {
                                console.error(`[ZemDomu] Error in rule ${rule.name} (${(_a = opts.filePath) !== null && _a !== void 0 ? _a : 'unknown'}):`, e);
                            }
                        }
                    }
                },
                exit(path) {
                    var _a;
                    for (const rule of activeRules) {
                        if (rule.exitJsx) {
                            try {
                                results.push(...rule.exitJsx(path));
                            }
                            catch (e) {
                                console.error(`[ZemDomu] Error in rule ${rule.name} (${(_a = opts.filePath) !== null && _a !== void 0 ? _a : 'unknown'}):`, e);
                            }
                        }
                    }
                },
            },
        });
        activeRules.forEach(r => r.end && results.push(...r.end()));
        return results;
    }
    const root = (0, simpleHtmlParser_1.parse)(content);
    const walk = (node) => {
        var _a, _b;
        for (const rule of activeRules) {
            if (rule.enterHtml) {
                try {
                    results.push(...rule.enterHtml(node));
                }
                catch (e) {
                    console.error(`[ZemDomu] Error in rule ${rule.name} (${(_a = opts.filePath) !== null && _a !== void 0 ? _a : 'unknown'}):`, e);
                }
            }
        }
        if (node.children) {
            for (const child of node.children) {
                walk(child);
            }
        }
        for (const rule of activeRules) {
            if (rule.exitHtml) {
                try {
                    results.push(...rule.exitHtml(node));
                }
                catch (e) {
                    console.error(`[ZemDomu] Error in rule ${rule.name} (${(_b = opts.filePath) !== null && _b !== void 0 ? _b : 'unknown'}):`, e);
                }
            }
        }
    };
    walk(root);
    activeRules.forEach(r => r.end && results.push(...r.end()));
    return results;
}

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ProjectLinter = void 0;
const fs = __importStar(__nccwpck_require__(1943));
const linter_1 = __nccwpck_require__(3512);
const component_analyzer_1 = __nccwpck_require__(6394);
class ProjectLinter {
    constructor(options = {}) {
        this.opts = options;
        this.analyzer = new component_analyzer_1.ComponentAnalyzer(this.opts);
    }
    clear() {
        this.analyzer = new component_analyzer_1.ComponentAnalyzer(this.opts);
    }
    async lintFile(filePath, content) {
        if (!content) {
            content = await fs.readFile(filePath, 'utf8');
        }
        const results = (0, linter_1.lint)(content, { ...this.opts, filePath });
        const byFile = new Map();
        byFile.set(filePath, [...results]);
        const xmlMode = /\.(jsx|tsx)$/.test(filePath);
        if (xmlMode) {
            const component = await this.analyzer.analyzeFile(filePath);
            if (component) {
                this.analyzer.registerComponent(component, results);
            }
            if (this.opts.crossComponentAnalysis) {
                const cross = this.analyzer.analyzeComponentTree();
                for (const r of cross) {
                    if (!r.filePath)
                        continue;
                    if (!byFile.has(r.filePath))
                        byFile.set(r.filePath, []);
                    byFile.get(r.filePath).push(r);
                }
            }
        }
        return byFile;
    }
    async lintFiles(filePaths) {
        const aggregated = new Map();
        for (const filePath of filePaths) {
            const fileMap = await this.lintFile(filePath);
            for (const [fp, res] of fileMap.entries()) {
                if (!aggregated.has(fp))
                    aggregated.set(fp, []);
                aggregated.get(fp).push(...res);
            }
        }
        return aggregated;
    }
}
exports.ProjectLinter = ProjectLinter;

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports["default"] = enforceListNesting;
const t = __importStar(__nccwpck_require__(6535));
const utils_1 = __nccwpck_require__(7633);
function enforceListNesting() {
    const stack = [];
    return {
        name: 'enforceListNesting',
        enterHtml(node) {
            if (node.type === 'element') {
                stack.push(node.tagName);
                if (node.tagName === 'li') {
                    const parent = stack[stack.length - 2];
                    if (!parent || !['ul', 'ol'].includes(parent)) {
                        return [{ line: 0, column: 0, message: '<li> must be inside a <ul> or <ol>', rule: 'enforceListNesting' }];
                    }
                }
            }
            return [];
        },
        exitHtml(node) {
            if (node.type === 'element') {
                stack.pop();
            }
            return [];
        },
        enterJsx(path) {
            var _a, _b, _c, _d, _e, _f;
            const tag = (0, utils_1.getTag)(path);
            if (tag === 'li') {
                const parentNode = (_b = (_a = path.parentPath) === null || _a === void 0 ? void 0 : _a.parentPath) === null || _b === void 0 ? void 0 : _b.node;
                let inList = false;
                if (parentNode && t.isJSXElement(parentNode)) {
                    const open = parentNode.openingElement;
                    const pTag = t.isJSXIdentifier(open.name) ? open.name.name.toLowerCase() : '';
                    inList = ['ul', 'ol'].includes(pTag);
                }
                if (!inList) {
                    const line = ((_d = (_c = path.node.loc) === null || _c === void 0 ? void 0 : _c.start.line) !== null && _d !== void 0 ? _d : 1) - 1;
                    const column = (_f = (_e = path.node.loc) === null || _e === void 0 ? void 0 : _e.start.column) !== null && _f !== void 0 ? _f : 0;
                    return [{ line, column, message: '<li> must be inside a <ul> or <ol>', rule: 'enforceListNesting' }];
                }
            }
            return [];
        },
    };
}

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports["default"] = noTabindexGreaterThanZero;
const utils_1 = __nccwpck_require__(7633);
function noTabindexGreaterThanZero() {
    const message = 'Tabindex greater than 0 should be avoided';
    return {
        name: 'noTabindexGreaterThanZero',
        enterHtml(node) {
            if (node.type === 'element' && node.attrs.tabindex !== undefined) {
                const value = Number(node.attrs.tabindex);
                if (!Number.isNaN(value) && value > 0) {
                    return [{ line: 0, column: 0, message, rule: 'noTabindexGreaterThanZero' }];
                }
            }
            return [];
        },
        enterJsx(path) {
            var _a, _b, _c, _d;
            const opening = path.node.openingElement;
            const tabindex = (0, utils_1.getJsxAttr)(opening, 'tabindex');
            if (tabindex !== undefined) {
                const value = Number(tabindex);
                if (!Number.isNaN(value) && value > 0) {
                    const line = ((_b = (_a = opening.loc) === null || _a === void 0 ? void 0 : _a.start.line) !== null && _b !== void 0 ? _b : 1) - 1;
                    const column = (_d = (_c = opening.loc) === null || _c === void 0 ? void 0 : _c.start.column) !== null && _d !== void 0 ? _d : 0;
                    return [{ line, column, message, rule: 'noTabindexGreaterThanZero' }];
                }
            }
            return [];
        },
    };
}

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports["default"] = preventEmptyInlineTags;
const t = __importStar(__nccwpck_require__(6535));
const utils_1 = __nccwpck_require__(7633);
const inlineTags = new Set(['strong', 'em', 'b', 'i', 'u', 'small', 'mark', 'del', 'ins']);
function preventEmptyInlineTags() {
    const stack = [];
    return {
        name: 'preventEmptyInlineTags',
        enterHtml(node) {
            if (node.type === 'element' && inlineTags.has(node.tagName)) {
                stack.push({ tag: node.tagName, found: false });
            }
            else if (node.type === 'text') {
                if (stack.length && node.text.trim())
                    stack[stack.length - 1].found = true;
            }
            return [];
        },
        exitHtml(node) {
            if (node.type === 'element' && inlineTags.has(node.tagName)) {
                const e = stack.pop();
                if (e && !e.found)
                    return [{ line: 0, column: 0, message: `<${e.tag}> tag should not be empty`, rule: 'preventEmptyInlineTags' }];
            }
            return [];
        },
        enterJsx(path) {
            const tag = (0, utils_1.getTag)(path);
            if (inlineTags.has(tag))
                stack.push({ tag, found: false });
            return [];
        },
        exitJsx(path) {
            var _a, _b, _c, _d, _e;
            const tag = (0, utils_1.getTag)(path);
            if (inlineTags.has(tag)) {
                const e = stack.pop();
                const parentNode = (_a = path.parentPath) === null || _a === void 0 ? void 0 : _a.node;
                const hasText = t.isJSXElement(parentNode) &&
                    parentNode.children.some(c => (t.isJSXText(c) && c.value.trim()) || t.isJSXExpressionContainer(c));
                if (e && !(e.found || hasText)) {
                    const line = ((_c = (_b = path.node.loc) === null || _b === void 0 ? void 0 : _b.start.line) !== null && _c !== void 0 ? _c : 1) - 1;
                    const column = (_e = (_d = path.node.loc) === null || _d === void 0 ? void 0 : _d.start.column) !== null && _e !== void 0 ? _e : 0;
                    return [{ line, column, message: `<${tag}> tag should not be empty`, rule: 'preventEmptyInlineTags' }];
                }
            }
            return [];
        },
    };
}

var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports["default"] = requireLinkText;
const t = __importStar(__nccwpck_require__(6535));
const utils_1 = __nccwpck_require__(7633);
function requireLinkText() {
    const stack = [];
    return {
        name: 'requireLinkText',
        enterHtml(node) {
            if (node.type === 'element' && node.tagName === 'a') {
                stack.push({ found: false });
            }
            else if (node.type === 'text') {
                if (stack.length && node.text.trim())
                    stack[stack.length - 1].found = true;
            }
            return [];
        },
        exitHtml(node) {
            if (node.type === 'element' && node.tagName === 'a') {
                const entry = stack.pop();
                if (entry && !entry.found)
                    return [{ line: 0, column: 0, message: '<a> tag missing link text', rule: 'requireLinkText' }];
            }
            return [];
        },
        enterJsx(path) {
            const tag = (0, utils_1.getTag)(path);
            if (tag === 'a')
                stack.push({ found: false });
            return [];
        },
        exitJsx(path) {
            var _a, _b, _c, _d, _e;
            const tag = (0, utils_1.getTag)(path);
            if (tag === 'a') {
                const entry = stack.pop();
                let hasText = false;
                const parentNode = (_a = path.parentPath) === null || _a === void 0 ? void 0 : _a.node;
                if (t.isJSXElement(parentNode) && Array.isArray(parentNode.children)) {
                    hasText = parentNode.children.some(c => (t.isJSXText(c) && c.value.trim()) || t.isJSXExpressionContainer(c));
                }
                if (entry && !(entry.found || hasText)) {
                    const line = ((_c = (_b = path.node.loc) === null || _b === void 0 ? void 0 : _b.start.line) !== null && _c !== void 0 ? _c : 1) - 1;
                    const column = (_e = (_d = path.node.loc) === null || _d === void 0 ? void 0 : _d.start.column) !== null && _e !== void 0 ? _e : 0;
                    return [{ line, column, message: '<a> tag missing link text', rule: 'requireLinkText' }];
                }
            }
            return [];
        },
    };
}
function parseCliArgs() {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith("--")) {
            const name = args[i].slice(2);
            let value = "true";
            if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
                value = args[i + 1];
                i++;
            }
            const key = `INPUT_${name.replace(/-/g, "").toUpperCase()}`;
            process.env[key] = value;
        }
    }
}
        // Read inputs
        const crossInput = core.getInput("crossComponentAnalysis");
        const cross = crossInput ? /^(true|1)$/i.test(crossInput) : false;
        // Expand glob patterns
            const matches = await (0, glob_1.glob)(pattern, {
                nodir: true,
                ignore: ["**/node_modules/**", "**/dist/**", "**/.github/**"],
            });
            for (const m of matches) {
            }
        // Run the linter
        // Report issues with annotations
        let foundErrors = false;
            if (issues.length > 0) {
                foundErrors = true;
            }
                    startColumn: issue.column != null ? issue.column + 1 : undefined,
        // If errors, provide a summary of files and lines
        if (foundErrors) {
            core.info("\nSemantic lint errors summary:");
            for (const [file, issues] of results.entries()) {
                if (issues.length > 0) {
                    core.info(`In file: ${file}`);
                    for (const issue of issues) {
                        const line = issue.line + 1;
                        const col = issue.column != null ? issue.column + 1 : 0;
                        core.info(`  Line ${line}:${col} — ${issue.rule}`);
                    }
                }
            }
            core.setFailed("Semantic lint errors found");
        }
parseCliArgs();
