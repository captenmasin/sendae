<script setup>
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
                        authMode === 'register'
                            ? 'Create account'
                            : authMode === 'forgotPassword'
                              ? 'Reset password'
                              : 'Sign in'
                    }}
                </h1>
                <p v-if="authMode === 'forgotPassword'">We’ll email you a secure reset link.</p>
                <p v-if="error" class="error-text" role="alert">{{ error }}</p>
                <p v-if="authNotice" role="status">{{ authNotice }}</p>
                <form @submit.prevent="submitAuth">
                    <label v-if="authMode === 'register'">
                        Name
                        <input v-model="fullName" autocomplete="name" maxlength="100" required />
                    </label>
                    <label>
                        Email
                        <input v-model="email" type="email" autocomplete="username" required autofocus />
                    </label>
                    <label v-if="authMode !== 'forgotPassword'">
                        {{ authMode === 'register' ? 'Password · at least 8 characters' : 'Password' }}
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
