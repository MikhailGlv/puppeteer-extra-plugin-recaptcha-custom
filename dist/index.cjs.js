/*!
 * puppeteer-extra-plugin-recaptcha-custom v3.0.6 by berstend
 * https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-recaptcha
 * @license MIT
 */
'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var puppeteerExtraPlugin = require('puppeteer-extra-plugin');
var Debug = _interopDefault(require('debug'));

const ContentScriptDefaultOpts = {
    visualFeedback: true
};
const ContentScriptDefaultData = {
    solutions: []
};
/**
 * Content script for Recaptcha handling (runs in browser context)
 * @note External modules are not supported here (due to content script isolation)
 */
class RecaptchaContentScript {
    constructor(opts = ContentScriptDefaultOpts, data = ContentScriptDefaultData) {
        // Poor mans _.pluck
        this._pick = (props) => (o) => props.reduce((a, e) => (Object.assign({}, a, { [e]: o[e] })), {});
        this.opts = opts;
        this.data = data;
    }
    // Recaptcha client is a nested, circular object with object keys that seem generated
    // We flatten that object a couple of levels deep for easy access to certain keys we're interested in.
    _flattenObject(item, levels = 2, ignoreHTML = true) {
        const isObject = (x) => x && typeof x === 'object';
        const isHTML = (x) => x && x instanceof HTMLElement;
        let newObj = {};
        for (let i = 0; i < levels; i++) {
            item = Object.keys(newObj).length ? newObj : item;
            Object.keys(item).forEach(key => {
                if (ignoreHTML && isHTML(item[key]))
                    return;
                if (isObject(item[key])) {
                    Object.keys(item[key]).forEach(innerKey => {
                        if (ignoreHTML && isHTML(item[key][innerKey]))
                            return;
                        const keyName = isObject(item[key][innerKey])
                            ? `obj_${key}_${innerKey}`
                            : `${innerKey}`;
                        newObj[keyName] = item[key][innerKey];
                    });
                }
                else {
                    newObj[key] = item[key];
                }
            });
        }
        return newObj;
    }
    // Helper function to return an object based on a well known value
    _getKeyByValue(object, value) {
        return Object.keys(object).find(key => object[key] === value);
    }
    async _waitUntilDocumentReady() {
        return new Promise(function (resolve) {
            if (!document || !window)
                return resolve();
            const loadedAlready = /^loaded|^i|^c/.test(document.readyState);
            if (loadedAlready)
                return resolve();
            function onReady() {
                resolve();
                document.removeEventListener('DOMContentLoaded', onReady);
                window.removeEventListener('load', onReady);
            }
            document.addEventListener('DOMContentLoaded', onReady);
            window.addEventListener('load', onReady);
        });
    }
    _paintCaptchaBusy($iframe) {
        try {
            if (this.opts.visualFeedback) {
                $iframe.style.filter = `opacity(60%) hue-rotate(400deg)`; // violet
            }
        }
        catch (error) {
            // noop
        }
        return $iframe;
    }
    _paintCaptchaSolved($iframe) {
        try {
            if (this.opts.visualFeedback) {
                $iframe.style.filter = `opacity(60%) hue-rotate(230deg)`; // green
            }
        }
        catch (error) {
            // noop
        }
        return $iframe;
    }
    _findVisibleIframeNodes() {
        return Array.from(document.querySelectorAll(`iframe[src^='https://www.google.com/recaptcha/api2/anchor'][name^="a-"]`));
    }
    _isCaptchaChallengeWindowPresent() {
        return Array.from(document.querySelectorAll(`iframe[src^='https://www.google.com/recaptcha/api2/bframe'][name^="c-"]`)).filter(x => window.getComputedStyle(x).visibility !== 'hidden').length > 0;
    }
    _findVisibleIframeNodeById(id) {
        return document.querySelector(`iframe[src^='https://www.google.com/recaptcha/api2/anchor'][name^="a-${id ||
            ''}"]`);
    }
    _hideChallengeWindowIfPresent(id) {
        let frame = document.querySelector(`iframe[src^='https://www.google.com/recaptcha/api2/bframe'][name^="c-${id || ''}"]`);
        if (!frame) {
            return;
        }
        while (frame && frame.parentElement && frame.parentElement !== document.body) {
            frame = frame.parentElement;
        }
        if (frame) {
            frame.style.visibility = 'hidden';
        }
    }
    getClients() {
        // Bail out early if there's no indication of recaptchas
        if (!window || !window.__google_recaptcha_client)
            return;
        if (!window.___grecaptcha_cfg || !window.___grecaptcha_cfg.clients) {
            return;
        }
        if (!Object.keys(window.___grecaptcha_cfg.clients).length)
            return;
        return window.___grecaptcha_cfg.clients;
    }
    getVisibleIframesIds() {
        // Find all visible recaptcha boxes through their iframes or showed challenges
        let includeInvisible = this._isCaptchaChallengeWindowPresent();
        return this._findVisibleIframeNodes()
            // do not exclude invisible recaptchas as it could be solved at the same manner
            .filter($f => includeInvisible || !$f.src.includes('invisible'))
            .map($f => this._paintCaptchaBusy($f))
            .filter($f => $f && $f.getAttribute('name'))
            .map($f => $f.getAttribute('name') || '') // a-841543e13666
            .map(rawId => rawId.split('-').slice(-1)[0] // a-841543e13666 => 841543e13666
        )
            .filter(id => id);
    }
    getResponseInputById(id) {
        if (!id)
            return;
        const $iframe = this._findVisibleIframeNodeById(id);
        if (!$iframe)
            return;
        const $parentForm = $iframe.closest(`form`);
        if ($parentForm) {
            return $parentForm.querySelector(`[name='g-recaptcha-response']`);
        }
    }
    getClientById(id) {
        if (!id)
            return;
        const clients = this.getClients();
        // Lookup captcha "client" info using extracted id
        let client = Object.values(clients || {})
            .filter(obj => this._getKeyByValue(obj, id))
            .shift(); // returns first entry in array or undefined
        if (!client)
            return;
        client = this._flattenObject(client);
        client.widgetId = client.id;
        client.id = id;
        return client;
    }
    extractInfoFromClient(client) {
        if (!client)
            return;
        const info = this._pick(['sitekey', 'callback'])(client);
        if (!info.sitekey)
            return;
        info.id = client.id;
        info.widgetId = client.widgetId;
        info.display = this._pick([
            'size',
            'top',
            'left',
            'width',
            'height',
            'theme'
        ])(client);
        // callbacks can be strings or funtion refs
        if (info.callback && typeof info.callback === 'function') {
            info.callback = info.callback.name || 'anonymous';
        }
        if (document && document.location)
            info.url = document.location.href;
        return info;
    }
    async findRecaptchas() {
        const result = {
            captchas: [],
            error: null
        };
        try {
            await this._waitUntilDocumentReady();
            const clients = this.getClients();
            if (!clients)
                return result;
            result.captchas = this.getVisibleIframesIds()
                .map(id => this.getClientById(id))
                .map(client => this.extractInfoFromClient(client))
                .map(info => {
                if (!info)
                    return;
                const $input = this.getResponseInputById(info.id);
                info.hasResponseElement = !!$input;
                return info;
            })
                .filter(info => info);
        }
        catch (error) {
            result.error = error;
            return result;
        }
        return result;
    }
    async enterRecaptchaSolutions() {
        const result = {
            solved: [],
            error: null
        };
        try {
            await this._waitUntilDocumentReady();
            const clients = this.getClients();
            if (!clients) {
                result.error = 'No recaptchas found';
                return result;
            }
            const solutions = this.data.solutions;
            if (!solutions || !solutions.length) {
                result.error = 'No solutions provided';
                return result;
            }
            result.solved = this.getVisibleIframesIds()
                .map(id => this.getClientById(id))
                .map(client => {
                const solved = {
                    id: client.id,
                    responseElement: false,
                    responseCallback: false
                };
                const $iframe = this._findVisibleIframeNodeById(solved.id);
                if (!$iframe) {
                    solved.error = `Iframe not found for id '${solved.id}'`;
                    return solved;
                }
                const solution = solutions.find(s => s.id === solved.id);
                if (!solution || !solution.text) {
                    solved.error = `Solution not found for id '${solved.id}'`;
                    return solved;
                }
                // Hide if present challenge window
                this._hideChallengeWindowIfPresent(solved.id);
                // Enter solution in response textarea
                const $input = this.getResponseInputById(solved.id);
                if ($input) {
                    $input.innerHTML = solution.text;
                    solved.responseElement = true;
                }
                // Enter solution in optional callback
                if (client.callback) {
                    try {
                        if (typeof client.callback === 'function') {
                            client.callback.call(window, solution.text);
                        }
                        else {
                            eval(client.callback).call(window, solution.text); // tslint:disable-line
                        }
                        solved.responseCallback = true;
                    }
                    catch (error) {
                        solved.error = error;
                    }
                }
                // Finishing up
                solved.isSolved = solved.responseCallback || solved.responseElement;
                solved.solvedAt = new Date();
                this._paintCaptchaSolved($iframe);
                return solved;
            });
        }
        catch (error) {
            result.error = error;
            return result;
        }
        return result;
    }
}
/*
// Example data

{
    "captchas": [{
        "sitekey": "6LdAUwoUAAAAAH44X453L0tUWOvx11XXXXXXXX",
        "id": "lnfy52r0cccc",
        "widgetId": 0,
        "display": {
            "size": null,
            "top": 23,
            "left": 13,
            "width": 28,
            "height": 28,
            "theme": null
        },
        "url": "https://example.com",
        "hasResponseElement": true
    }],
    "error": null
}

{
    "solutions": [{
        "id": "lnfy52r0cccc",
        "provider": "2captcha",
        "providerCaptchaId": "61109548000",
        "text": "03AF6jDqVSOVODT-wLKZ47U0UXz...",
        "requestAt": "2019-02-09T18:30:43.587Z",
        "responseAt": "2019-02-09T18:30:57.937Z"
    }]
    "error": null
}

{
    "solved": [{
        "id": "lnfy52r0cccc",
        "responseElement": true,
        "responseCallback": false,
        "isSolved": true,
        "solvedAt": {}
    }]
    "error": null
}
*/

const PROVIDER_ID = '2captcha';
const debug = Debug(`puppeteer-extra-plugin:recaptcha:${PROVIDER_ID}`);
const solver = require('2captcha-api');
const secondsBetweenDates = (before, after) => (after.getTime() - before.getTime()) / 1000;
async function decodeRecaptchaAsync(token, sitekey, url, opts = { pollingInterval: 2000 }) {
    return new Promise(resolve => {
        const cb = (err, result, invalid) => resolve({ err, result, invalid });
        try {
            solver.setApiKey(token);
            solver.decodeReCaptcha(sitekey, url, opts, cb);
        }
        catch (error) {
            return resolve({ err: error });
        }
    });
}
async function getSolutions(captchas = [], token) {
    const solutions = await Promise.all(captchas.map(c => getSolution(c, token || '')));
    return { solutions, error: solutions.find(s => !!s.error) };
}
async function getSolution(captcha, token) {
    const solution = {
        provider: PROVIDER_ID
    };
    try {
        if (!captcha || !captcha.sitekey || !captcha.url || !captcha.id) {
            throw new Error('Missing data in captcha');
        }
        solution.id = captcha.id;
        solution.requestAt = new Date();
        debug('Requesting solution..', solution);
        const { err, result, invalid } = await decodeRecaptchaAsync(token, captcha.sitekey, captcha.url);
        debug('Got response', { err, result, invalid });
        if (err)
            throw new Error(`${PROVIDER_ID} error: ${err}`);
        if (!result || !result.text || !result.id) {
            throw new Error(`${PROVIDER_ID} error: Missing response data: ${result}`);
        }
        solution.providerCaptchaId = result.id;
        solution.text = result.text;
        solution.responseAt = new Date();
        solution.hasSolution = !!solution.text;
        solution.duration = secondsBetweenDates(solution.requestAt, solution.responseAt);
    }
    catch (error) {
        debug('Error', error);
        solution.error = error.toString();
    }
    return solution;
}

const BuiltinSolutionProviders = [
    {
        id: PROVIDER_ID,
        fn: getSolutions
    }
];
/**
 * A puppeteer-extra plugin to automatically detect and solve reCAPTCHAs.
 * @noInheritDoc
 */
class PuppeteerExtraPluginRecaptcha extends puppeteerExtraPlugin.PuppeteerExtraPlugin {
    constructor(opts) {
        super(opts);
        this.debug('Initialized', this.opts);
    }
    get name() {
        return 'recaptcha';
    }
    get defaults() {
        return {
            visualFeedback: true,
            throwOnError: false
        };
    }
    get contentScriptOpts() {
        const { visualFeedback } = this.opts;
        return {
            visualFeedback
        };
    }
    _generateContentScript(fn, data) {
        this.debug('_generateContentScript', fn, data);
        return `(async() => {
      const DATA = ${JSON.stringify(data || null)}
      const OPTS = ${JSON.stringify(this.contentScriptOpts)}

      ${RecaptchaContentScript.toString()}
      const script = new RecaptchaContentScript(OPTS, DATA)
      return script.${fn}()
    })()`;
    }
    async findRecaptchas(page) {
        this.debug('findRecaptchas');
        // As this might be called very early while recaptcha is still loading
        // we add some extra waiting logic for developer convenience.
        const hasRecaptchaScriptTag = await page.$(`script[src="https://www.google.com/recaptcha/api.js"]`);
        this.debug('hasRecaptchaScriptTag', !!hasRecaptchaScriptTag);
        if (hasRecaptchaScriptTag) {
            this.debug('waitForRecaptchaClient - start', new Date());
            await page.waitForFunction(`
        (function() {
          return window.___grecaptcha_cfg && window.___grecaptcha_cfg.count
        })()
      `, { polling: 200, timeout: 10 * 1000 });
            this.debug('waitForRecaptchaClient - end', new Date()); // used as timer
        }
        // Even without a recaptcha script tag we're trying, just in case.
        const response = await page.evaluate(this._generateContentScript('findRecaptchas'));
        this.debug('findRecaptchas', response);
        if (this.opts.throwOnError && response.error) {
            throw new Error(response.error);
        }
        return response;
    }
    async getRecaptchaSolutions(captchas, provider) {
        this.debug('getRecaptchaSolutions');
        provider = provider || this.opts.provider;
        if (!provider || (!provider.token && !provider.fn)) {
            throw new Error('Please provide a solution provider to the plugin.');
        }
        let fn = provider.fn;
        if (!fn) {
            const builtinProvider = BuiltinSolutionProviders.find(p => p.id === (provider || {}).id);
            if (!builtinProvider || !builtinProvider.fn) {
                throw new Error(`Cannot find builtin provider with id '${provider.id}'.`);
            }
            fn = builtinProvider.fn;
        }
        const response = await fn.call(this, captchas, provider.token);
        response.error =
            response.error ||
                response.solutions.find((s) => !!s.error);
        this.debug('getRecaptchaSolutions', response);
        if (this.opts.throwOnError && response.error) {
            throw new Error(response.error);
        }
        return response;
    }
    async enterRecaptchaSolutions(page, solutions) {
        this.debug('enterRecaptchaSolutions');
        const response = await page.evaluate(this._generateContentScript('enterRecaptchaSolutions', { solutions }));
        response.error = response.error || response.solved.find(s => !!s.error);
        this.debug('enterRecaptchaSolutions', response);
        if (this.opts.throwOnError && response.error) {
            throw new Error(response.error);
        }
        return response;
    }
    async solveRecaptchas(page) {
        this.debug('solveRecaptchas');
        const response = {
            captchas: [],
            solutions: [],
            solved: [],
            error: null
        };
        try {
            // If `this.opts.throwOnError` is set any of the
            // following will throw and abort execution.
            const { captchas, error: captchasError } = await this.findRecaptchas(page);
            response.captchas = captchas;
            if (captchas.length) {
                const { solutions, error: solutionsError } = await this.getRecaptchaSolutions(response.captchas);
                response.solutions = solutions;
                const { solved, error: solvedError } = await this.enterRecaptchaSolutions(page, response.solutions);
                response.solved = solved;
                response.error = captchasError || solutionsError || solvedError;
            }
        }
        catch (error) {
            response.error = error.toString();
        }
        this.debug('solveRecaptchas', response);
        if (this.opts.throwOnError && response.error) {
            throw new Error(response.error);
        }
        return response;
    }
    async onPageCreated(page) {
        this.debug('onPageCreated');
        // Make sure we can run our content script
        await page.setBypassCSP(true);
        // Add custom page methods
        page.findRecaptchas = async () => this.findRecaptchas(page);
        page.getRecaptchaSolutions = async (captchas, provider) => this.getRecaptchaSolutions(captchas, provider);
        page.enterRecaptchaSolutions = async (solutions) => this.enterRecaptchaSolutions(page, solutions);
        // Add convenience methods that wraps all others
        page.solveRecaptchas = async () => this.solveRecaptchas(page);
    }
}
var index = (options) => {
    return new PuppeteerExtraPluginRecaptcha(options || {});
};

exports.BuiltinSolutionProviders = BuiltinSolutionProviders;
exports.PuppeteerExtraPluginRecaptcha = PuppeteerExtraPluginRecaptcha;
exports.default = index;


  module.exports = exports.default || {}
  Object.entries(exports).forEach(([key, value]) => { module.exports[key] = value })
//# sourceMappingURL=index.cjs.js.map
