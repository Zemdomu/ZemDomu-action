const { lint } = require('zemdomu');

const ruleNames = [
  'requireSectionHeading',
  'enforceHeadingOrder',
  'singleH1',
  'requireAltText',
  'requireLabelForFormControls',
  'enforceListNesting',
  'requireLinkText',
  'requireTableCaption',
  'preventEmptyInlineTags',
  'requireHrefOnAnchors',
  'requireButtonText',
  'requireIframeTitle',
  'requireHtmlLang',
  'requireImageInputAlt',
  'requireNavLinks',
  'uniqueIds',
  'noTabindexGreaterThanZero',
];

const snippets = {
  requireSectionHeading: '<section></section>',
  enforceHeadingOrder: '<h1></h1><h3></h3>',
  singleH1: '<h1></h1><h1></h1>',
  requireAltText: '<img>',
  requireLabelForFormControls: '<input id="a">',
  enforceListNesting: '<li>Item</li>',
  requireLinkText: '<a href="#"></a>',
  requireTableCaption: '<table></table>',
  preventEmptyInlineTags: '<strong></strong>',
  requireHrefOnAnchors: '<a></a>',
  requireButtonText: '<button></button>',
  requireIframeTitle: '<iframe></iframe>',
  requireHtmlLang: '<html></html>',
  requireImageInputAlt: '<input type="image">',
  requireNavLinks: '<nav></nav>',
  uniqueIds: '<div id="x"></div><div id="x"></div>',
  noTabindexGreaterThanZero: '<div tabindex="5"></div>',
};

function baseRules() {
  const obj = {};
  for (const name of ruleNames) obj[name] = false;
  return obj;
}

for (const name of ruleNames) {
  const rules = { ...baseRules(), [name]: true };
  const results = lint(snippets[name], { rules });
  if (!results.some(r => r.rule === name)) {
    console.error(`Rule ${name} did not trigger`);
    process.exit(1);
  }
}

console.log('All rule tests passed.');
