"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const puppeteer_extra_plugin_1 = require("puppeteer-extra-plugin");
const content_1 = require("./content");
const TwoCaptcha = __importStar(require("./provider/2captcha"));
exports.BuiltinSolutionProviders = [
    {
        id: TwoCaptcha.PROVIDER_ID,
        fn: TwoCaptcha.getSolutions
    }
];
/**
 * A puppeteer-extra plugin to automatically detect and solve reCAPTCHAs.
 * @noInheritDoc
 */
class PuppeteerExtraPluginRecaptcha extends puppeteer_extra_plugin_1.PuppeteerExtraPlugin {
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

      ${content_1.RecaptchaContentScript.toString()}
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
            const builtinProvider = exports.BuiltinSolutionProviders.find(p => p.id === (provider || {}).id);
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
exports.PuppeteerExtraPluginRecaptcha = PuppeteerExtraPluginRecaptcha;
exports.default = (options) => {
    return new PuppeteerExtraPluginRecaptcha(options || {});
};
//# sourceMappingURL=index.js.map