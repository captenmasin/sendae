import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as Vue from 'vue';

function workspace(request) {
    let mount;
    const source = readFileSync(new URL('../resources/js/workspace.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/, '').replaceAll('export ', '');
    const document = { visibilityState: 'hidden', documentElement: { dataset: {} }, querySelector: () => ({ content: 'csrf' }), addEventListener() {} };
    const api = runInNewContext(source + ';createWorkspace()', {
        ...Vue, onMounted(callback) { mount = callback; }, onBeforeUnmount() {},
        document, window: { addEventListener() {} }, localStorage: { getItem() {}, setItem() {} },
        fetch: request, setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {},
        URL, Date, Intl, console, FormData, TextEncoder,
    });
    return { api, mount: () => mount() };
}

const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

test('provider sign-in opens the browser and displays actionable failures', async () => {
    const requests = [];
    const app = workspace(async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return response({ opened: true });
    });
    for (const provider of ['google', 'facebook', 'x']) {
        await app.api.startSocialSignIn(provider);
        assert.equal(requests.at(-1).url, '/local/socialSignIn');
        assert.equal(requests.at(-1).body.provider, provider);
        assert.match(app.api.authNotice.value, /browser/);
    }
    const failed = workspace(async () => response({ message: 'This sign-in provider is not available yet.' }, 503));
    await failed.api.startSocialSignIn('google');
    assert.equal(failed.api.error.value, 'This sign-in provider is not available yet.');
    assert.equal(failed.api.busy.value, false);
});

test('a desktop handoff asks for missing details and completes sign-in without exposing tokens', async () => {
    const requests = [];
    let signedIn = false;
    const ticket = 't'.repeat(64);
    const app = workspace(async (url, options) => {
        const body = options?.body ? JSON.parse(options.body) : null;
        requests.push({ url, body });
        if (url === '/local/state') return signedIn
            ? response({ drafts: [], accounts: [], media: [], publications: [], settings: { paired: true, workspace_id: 'b'.repeat(64) } })
            : response({ message: 'Sign in' }, 401);
        if (url === '/local/link') return response({ action: 'sign-in', ticket });
        if (url === '/local/finishSocialSignIn') {
            if (!body.email) return response({ needs_profile: true, name: 'Person', email: '' });
            signedIn = true;
            return response({ signed_in: true, workspace_changed: true });
        }
        if (url === '/local/sync') return response({});
        throw new Error('Unexpected request: ' + url);
    });
    await app.mount();
    assert.equal(app.api.authMode.value, 'socialProfile');
    assert.equal(app.api.fullName.value, 'Person');
    assert.equal(app.api.authenticated.value, false);
    app.api.email.value = 'person@example.com';
    app.api.password.value = 'existing-password';
    await app.api.submitAuth();
    assert.equal(app.api.authenticated.value, true);
    assert.equal(app.api.password.value, '');
    assert.equal(app.api.authNotice.value, '');
    const finish = requests.filter(request => request.url === '/local/finishSocialSignIn');
    assert.equal(finish.length, 2);
    assert.equal(finish[1].body.ticket, ticket);
    assert.equal(finish[1].body.password, 'existing-password');
});

test('only an existing-account password error opens the account linking step', async () => {
    let passwordNeeded = false;
    const requests = [];
    const app = workspace(async (url, options) => {
        const body = JSON.parse(options.body);
        requests.push(body);
        if (passwordNeeded) return response({ errors: { password: ['Enter your existing Sendae password to link this sign-in.'] } }, 422);
        return response({ errors: { email: ['Enter a valid email.'] } }, 422);
    });
    app.api.authMode.value = 'socialProfile';
    app.api.email.value = 'existing@example.com';
    app.api.fullName.value = 'Person';

    await app.api.submitAuth();
    assert.equal(app.api.authMode.value, 'socialProfile');
    passwordNeeded = true;
    await app.api.submitAuth();
    assert.equal(app.api.authMode.value, 'socialLink');
    assert.match(app.api.authNotice.value, /An account already uses this email/);
    assert.equal(app.api.email.value, 'existing@example.com');
    app.api.password.value = 'existing-password';
    await app.api.submitAuth();
    assert.equal(requests.at(-1).password, 'existing-password');
    assert.equal(app.api.password.value, '');
    app.api.chooseAuth('signIn');
    assert.equal(app.api.authNotice.value, '');
});


test('password setup sends a reset link to the signed-in account email', async () => {
    const requests = [];
    const app = workspace(async (url, options) => {
        if (url === '/local/state') return response({ drafts: [], accounts: [], media: [], publications: [], settings: { paired: true, email: 'social@example.com', has_password: false } });
        if (url === '/local/link') return response({});
        requests.push({ url, body: JSON.parse(options.body) });
        return response({ message: 'Sent' });
    });
    await app.mount();
    app.api.profileForm.value.email = 'edited@example.com';
    await app.api.requestPasswordSetup();
    assert.equal(requests.at(-1).url, '/local/forgotPassword');
    assert.equal(requests.at(-1).body.email, 'social@example.com');
    assert.match(app.api.notice.value, /secure link/);
    assert.equal(app.api.authenticated.value, true);
});

test('registration immediately signs in and opens the new workspace', async () => {
    const requests = [];
    const app = workspace(async (url, options) => {
        requests.push({ url, body: options?.body ? JSON.parse(options.body) : null });
        if (url === '/local/registration') return response({ message: 'Account created. Sign in to Sendae to continue.' });
        if (url === '/local/signIn') return response({ workspace_changed: true });
        if (url === '/local/state') return response({ drafts: [], accounts: [], media: [], publications: [], settings: { paired: true, workspace_id: 'b'.repeat(64) } });
        if (url === '/local/sync') return response({});
        throw new Error('Unexpected request: ' + url);
    });
    app.api.authMode.value = 'register';
    app.api.email.value = 'new@example.com';
    app.api.password.value = 'new-password';
    app.api.confirmPassword.value = 'new-password';
    await app.api.submitAuth();
    assert.deepEqual(requests.slice(0, 2).map(request => request.url), ['/local/registration', '/local/signIn']);
    assert.deepEqual(requests[1].body, { email: 'new@example.com', password: 'new-password' });
    assert.equal(app.api.authenticated.value, true);
    assert.equal(app.api.authNotice.value, '');
    assert.equal(app.api.password.value, '');
    assert.equal(app.api.confirmPassword.value, '');
});

test('failed automatic sign-in leaves the new account ready to retry', async () => {
    const app = workspace(async url => url === '/local/registration'
        ? response({ message: 'Account created.' })
        : response({ message: 'Service unavailable.' }, 503));
    app.api.authMode.value = 'register';
    app.api.email.value = 'new@example.com';
    app.api.password.value = 'new-password';
    await app.api.submitAuth();
    assert.equal(app.api.authenticated.value, false);
    assert.equal(app.api.authMode.value, 'signIn');
    assert.equal(app.api.email.value, 'new@example.com');
    assert.equal(app.api.password.value, 'new-password');
    assert.equal(app.api.error.value, 'Service unavailable.');
    assert.equal(app.api.busy.value, false);
});
