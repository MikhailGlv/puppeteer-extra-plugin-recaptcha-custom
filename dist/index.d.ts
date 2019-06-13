import { PuppeteerExtraPlugin } from 'puppeteer-extra-plugin';
import * as types from './types';
export declare const BuiltinSolutionProviders: types.SolutionProvider[];
/**
 * A puppeteer-extra plugin to automatically detect and solve reCAPTCHAs.
 * @noInheritDoc
 */
export declare class PuppeteerExtraPluginRecaptcha extends PuppeteerExtraPlugin {
    constructor(opts: Partial<types.PluginOptions>);
    readonly name: string;
    readonly defaults: types.PluginOptions;
    readonly contentScriptOpts: types.ContentScriptOpts;
    private _generateContentScript;
    findRecaptchas(page: types.Page): Promise<types.FindRecaptchasResult>;
    getRecaptchaSolutions(captchas: types.CaptchaInfo[], provider?: types.SolutionProvider): Promise<types.GetSolutionsResult>;
    enterRecaptchaSolutions(page: types.Page, solutions: types.CaptchaSolution[]): Promise<types.EnterRecaptchaSolutionsResult>;
    solveRecaptchas(page: types.Page): Promise<types.SolveRecaptchasResult>;
    onPageCreated(page: types.Page): Promise<void>;
}
declare const _default: (options?: Partial<types.PluginOptions> | undefined) => PuppeteerExtraPluginRecaptcha;
export default _default;
