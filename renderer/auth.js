/**
 * Authentication Page Script
 * Handles login and registration forms
 */

// =============================================================================
// DOM ELEMENTS
// =============================================================================

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const tabBtns = document.querySelectorAll('.tab-btn');
const authMessage = document.getElementById('auth-message');

// =============================================================================
// TAB SWITCHING
// =============================================================================

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;

        // Update active tab button
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Show corresponding form
        if (tab === 'login') {
            loginForm.classList.add('active');
            registerForm.classList.remove('active');
        } else {
            registerForm.classList.add('active');
            loginForm.classList.remove('active');
        }

        // Clear messages
        hideMessage();
    });
});

// =============================================================================
// MESSAGE DISPLAY
// =============================================================================

function showMessage(text, type = 'error') {
    authMessage.textContent = text;
    authMessage.className = `message ${type}`;
    authMessage.classList.remove('hidden');
}

function hideMessage() {
    authMessage.classList.add('hidden');
}

// =============================================================================
// LOADING STATE
// =============================================================================

function setLoading(form, isLoading) {
    const btn = form.querySelector('button[type="submit"]');
    const btnText = btn.querySelector('.btn-text');
    const btnLoader = btn.querySelector('.btn-loader');

    if (isLoading) {
        btn.disabled = true;
        btnText.classList.add('hidden');
        btnLoader.classList.remove('hidden');
    } else {
        btn.disabled = false;
        btnText.classList.remove('hidden');
        btnLoader.classList.add('hidden');
    }
}

// =============================================================================
// LOGIN HANDLER
// =============================================================================

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessage();

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        showMessage('Please fill in all fields');
        return;
    }

    setLoading(loginForm, true);

    try {
        const result = await window.api.login({ email, password });

        if (result.success) {
            showMessage('Login successful! Loading...', 'success');
            // Window will close and main window will open automatically
        } else {
            showMessage(result.error || 'Login failed. Please check your credentials.');
        }
    } catch (error) {
        showMessage('An error occurred. Please try again.');
        console.error('Login error:', error);
    } finally {
        setLoading(loginForm, false);
    }
});

// =============================================================================
// REGISTER HANDLER
// =============================================================================

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessage();

    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm').value;

    // Validation
    if (!name || !email || !password || !confirm) {
        showMessage('Please fill in all fields');
        return;
    }

    if (password.length < 8) {
        showMessage('Password must be at least 8 characters');
        return;
    }

    if (password !== confirm) {
        showMessage('Passwords do not match');
        return;
    }

    setLoading(registerForm, true);

    try {
        const result = await window.api.register({ email, password, name });

        if (result.success) {
            showMessage('Account created! Loading...', 'success');
            // Window will close and main window will open automatically
        } else {
            showMessage(result.error || 'Registration failed. Please try again.');
        }
    } catch (error) {
        showMessage('An error occurred. Please try again.');
        console.error('Register error:', error);
    } finally {
        setLoading(registerForm, false);
    }
});

// =============================================================================
// ENTER KEY SUPPORT
// =============================================================================

document.querySelectorAll('input').forEach(input => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const form = input.closest('form');
            form.dispatchEvent(new Event('submit'));
        }
    });
});

// =============================================================================
// FORGOT PASSWORD
// =============================================================================

document.querySelector('.forgot-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    showMessage('Password recovery is not implemented in this demo', 'error');
});
