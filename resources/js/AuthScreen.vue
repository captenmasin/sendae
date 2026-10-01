<script setup>
import Icon from './Icon.vue';
import AccountLogo from './AccountLogo.vue';
import { useWorkspace } from './workspace.js';

const {
    authMode,
    authNotice,
    busy,
    chooseAuth,
    confirmPassword,
    email,
    error,
    fullName,
    loaded,
    password,
    startSocialSignIn,
    submitAuth,
} = useWorkspace();
</script>

<template>
    <main class="auth-screen">
        <section class="settings-card auth-card" aria-labelledby="sign-in-title">
            <div class="brand">
                sendae
                <span>✳</span>
            </div>
            <p v-if="!loaded" role="status">Opening Sendae…</p>
            <template v-else>
                <h1 id="sign-in-title">
                    {{
                        authMode === 'socialLink'
                            ? 'Connect your account'
                            : authMode === 'socialProfile'
                            ? 'Finish signing in'
                            : authMode === 'register'
                              ? 'Create account'
                              : authMode === 'forgotPassword'
                                ? 'Reset password'
                                : 'Sign in'
                    }}
                </h1>
                <p v-if="authMode === 'forgotPassword'">We’ll email you a secure reset link.</p>
                <div v-if="error" class="auth-error" role="alert">
                    <Icon name="CircleAlert" :size="18" />
                    <span>{{ error }}</span>
                </div>
                <p v-if="authNotice" role="status">{{ authNotice }}</p>
                <div v-if="['signIn', 'register'].includes(authMode)" class="social-sign-in">
                    <button
                        v-for="(label, provider) in { google: 'Google', facebook: 'Facebook', x: 'X' }"
                        :key="provider" class="outline" type="button" :disabled="busy"
                        @click="startSocialSignIn(provider)"
                    >
                        <svg v-if="provider === 'google'" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                            <path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24v7.42h11c-.47 2.4-1.85 4.43-3.92 5.79v4.81h6.35c3.71-3.42 6.18-8.46 6.18-14.1Z" />
                            <path fill="#34A853" d="M24 44c5.4 0 9.93-1.79 13.24-4.86l-6.35-4.81c-1.77 1.19-4.04 1.9-6.89 1.9-5.24 0-9.68-3.54-11.27-8.31H6.18v4.96A20 20 0 0 0 24 44Z" />
                            <path fill="#FBBC05" d="M12.73 27.92a12 12 0 0 1 0-7.84v-4.96H6.18a20 20 0 0 0 0 17.76l6.55-4.96Z" />
                            <path fill="#EA4335" d="M24 11.77c2.94 0 5.58 1.01 7.65 3L37.39 9C33.93 5.77 29.4 4 24 4A20 20 0 0 0 6.18 15.12l6.55 4.96c1.59-4.77 6.03-8.31 11.27-8.31Z" />
                        </svg>
                        <AccountLogo v-else :provider="provider" :size="18" aria-hidden="true" :style="{ color: provider === 'facebook' ? '#0866ff' : 'var(--ink)' }" />
                        Continue with {{ label }}
                    </button>
                    <p>Or use your email</p>
                </div>
                <form @submit.prevent="submitAuth">
                    <label v-if="['register', 'socialProfile'].includes(authMode)">
                        Name
                        <input v-model="fullName" autocomplete="name" maxlength="100" required />
                    </label>
                    <label>
                        Email
                        <input v-model="email" type="email" autocomplete="username" :readonly="authMode === 'socialLink'" required autofocus />
                    </label>
                    <label v-if="!['forgotPassword', 'socialProfile'].includes(authMode)">
                        {{ authMode === 'socialLink' ? 'Sendae password' : authMode === 'register' ? 'Password · at least 8 characters' : 'Password' }}
                        <input
                            v-model="password"
                            type="password"
                            :autocomplete="authMode === 'register' ? 'new-password' : 'current-password'"
                            :minlength="authMode === 'register' ? 8 : undefined"
                            required
                        />
                    </label>
                    <label v-if="authMode === 'register'">
                        Confirm password
                        <input
                            v-model="confirmPassword"
                            type="password"
                            autocomplete="new-password"
                            required
                        />
                    </label>
                    <button class="primary" :disabled="busy">
                        {{
                            busy
                                ? 'Please wait…'
                                : authMode === 'register'
                                  ? 'Create account'
                                  : authMode === 'forgotPassword'
                                    ? 'Send reset link'
                                    : authMode === 'socialLink'
                                      ? 'Connect account'
                                      : authMode === 'socialProfile'
                                      ? 'Continue'
                                      : 'Sign in'
                        }}
                    </button>
                </form>
                <div class="auth-links">
                    <template v-if="authMode === 'signIn'">
                        <button class="text-button" @click="chooseAuth('register')" :disabled="busy">
                            Create an account
                        </button>
                        <button class="text-button" @click="chooseAuth('forgotPassword')" :disabled="busy">
                            Forgot password?
                        </button>
                    </template>
                    <button v-else class="text-button" @click="chooseAuth('signIn')" :disabled="busy">
                        Back to sign in
                    </button>
                </div>
            </template>
        </section>
    </main>
</template>
