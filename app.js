/* ============================================
   MozPay — App Logic
   ============================================ */

const SUPABASE_URL = window.location.origin + '/supabase';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZib2pteGl3dnViZXBveXdkaGhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MTgzNTgsImV4cCI6MjA5MjI5NDM1OH0.2h2RL0HY885TnPoRZEQQbjVr1PVKoxpppzRs9wMqCp0';

// Configure Supabase to persist session in localStorage (keep user logged in)
// storageKey is pinned to the real project ref so the localStorage key never
// changes even if we route requests through a proxy URL.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        storage: window.localStorage,
        storageKey: 'sb-fbojmxiwvubepoywdhhc-auth-token',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
    }
});

/* ============================================
   MAINTENANCE MODE — Shared helper used by both
   index.html (app.js) and home.html (home.js).
   Renders the maintenance screen and wires the
   10-second logo-hold gesture that opens the
   admin panel password screen (admin.html).
   ============================================ */
window.__mozpayShowMaintenanceScreen = function showMaintenanceScreen() {
    if (window.__mozpayMaintenanceShown) return;
    window.__mozpayMaintenanceShown = true;

    document.body.innerHTML = `
        <div id="maintScreen" style="position:fixed;inset:0;background:#050505;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:'Hanken Grotesk',sans-serif;text-align:center;padding:20px;overflow:hidden;">
            <div id="maintLogo" role="button" aria-label="Logo MozPay" style="margin-bottom:24px;cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;touch-action:none;padding:14px;border-radius:14px;">
                <svg viewBox="0 0 40 40" width="60" height="60" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;pointer-events:none;">
                    <rect width="40" height="40" rx="10" fill="#E50914"/>
                    <path d="M12 10 L12 30 L17 30 L17 20 L20 25 L23 20 L23 30 L28 30 L28 10 L23 10 L20 16 L17 10 Z" fill="white"/>
                </svg>
            </div>
            <h1 style="font-size:1.6rem;font-weight:800;margin-bottom:12px;">Em Manutenção</h1>
            <p style="color:rgba(255,255,255,0.6);font-size:1rem;max-width:320px;line-height:1.6;">A plataforma está temporariamente indisponível para manutenção. Voltaremos em breve!</p>
            <p style="color:rgba(255,255,255,0.3);margin-top:32px;font-size:0.85rem;">© MozPay 2025</p>
        </div>`;

    // 10-second hold gesture on the logo to open admin login screen.
    // No visible progress bar — the gesture is hidden so regular users
    // never know an admin entry exists.
    const logo = document.getElementById('maintLogo');
    if (!logo) return;

    const HOLD_MS = 10000;
    let holdTimer = null;
    let activePointerId = null;
    let startedAt = 0;
    let startX = 0, startY = 0;
    const MOVE_TOLERANCE = 60; // px — finger may shift while holding

    function navigateToAdmin() {
        cleanup();
        window.location.href = 'admin.html';
    }

    function startHold(e) {
        if (e && e.cancelable) { try { e.preventDefault(); } catch (_) {} }
        if (holdTimer) return;
        startedAt = Date.now();
        if (e && e.pointerId != null) {
            activePointerId = e.pointerId;
            try { logo.setPointerCapture(e.pointerId); } catch(_) {}
        }
        const t = (e && e.touches && e.touches[0]) || e;
        startX = (t && t.clientX) || 0;
        startY = (t && t.clientY) || 0;
        holdTimer = setTimeout(navigateToAdmin, HOLD_MS);
    }

    function cleanup() {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        if (activePointerId != null) {
            try { logo.releasePointerCapture(activePointerId); } catch(_) {}
            activePointerId = null;
        }
    }

    function cancelHold(e) { cleanup(); }

    function onMove(e) {
        if (!holdTimer) return;
        const t = (e && e.touches && e.touches[0]) || e;
        if (!t) return;
        const dx = (t.clientX || 0) - startX;
        const dy = (t.clientY || 0) - startY;
        if (Math.hypot(dx, dy) > MOVE_TOLERANCE) cleanup();
    }

    // Prefer Pointer Events when available (works for mouse + touch + pen).
    if (window.PointerEvent) {
        logo.addEventListener('pointerdown',   startHold);
        logo.addEventListener('pointerup',     cancelHold);
        logo.addEventListener('pointercancel', cancelHold);
        logo.addEventListener('pointermove',   onMove);
    } else {
        logo.addEventListener('mousedown',  startHold);
        logo.addEventListener('touchstart', startHold, { passive: false });
        logo.addEventListener('mouseup',    cancelHold);
        logo.addEventListener('touchend',   cancelHold);
        logo.addEventListener('touchcancel',cancelHold);
        logo.addEventListener('touchmove',  onMove, { passive: true });
    }
    // Block long-press menus / drag on mobile.
    logo.addEventListener('contextmenu', (e) => e.preventDefault());
    logo.addEventListener('dragstart',   (e) => e.preventDefault());
    logo.addEventListener('selectstart', (e) => e.preventDefault());
};

window.__mozpayCheckMaintenance = async function checkMaintenance() {
    if (window.__mozpayMaintenanceShown) return true;
    try {
        const { data: maintenanceSetting } = await supabaseClient
            .from('system_settings')
            .select('value')
            .eq('key', 'maintenance_mode')
            .single();
        if (maintenanceSetting && maintenanceSetting.value === 'true') {
            window.__mozpayShowMaintenanceScreen();
            return true;
        }
    } catch (_) { /* ignore — fail-open so the app stays usable */ }
    return false;
};

document.addEventListener('DOMContentLoaded', async () => {
    // Maintenance check runs on every page (login + home). If active,
    // it replaces the body with the maintenance screen and we stop here.
    if (await window.__mozpayCheckMaintenance()) return;

    // Only run login/redirect logic on the login page (index.html), not on home.html
    const isHomePage = window.location.pathname.includes('home.html') || window.location.pathname.includes('home');
    if (isHomePage) return; // home.js handles everything on home.html

    // Force logout if ?logout=true is in the URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('logout') === 'true') {
        await supabaseClient.auth.signOut();
        window.location.href = 'index.html';
        return;
    }

    // Prefill invite code from URL (?code=ABCDEFG) and auto-open signup
    const urlInviteCode = (urlParams.get('code') || '').toUpperCase().trim();
    if (urlInviteCode && /^[A-Z0-9]{7}$/.test(urlInviteCode)) {
        const tryFill = () => {
            const inp = document.getElementById('inviteCodeInput');
            if (inp) {
                inp.value = urlInviteCode;
                inp.setAttribute('readonly', 'readonly');
                inp.style.opacity = '0.85';
                const lbl = document.querySelector('label[for="inviteCodeInput"]');
                if (lbl) lbl.classList.add('floating');
            }
        };
        // Defer to ensure form rendered, and attempt to switch to signup mode
        setTimeout(() => {
            tryFill();
            try {
                const link = document.getElementById('registerLink');
                if (link) link.click();
                setTimeout(tryFill, 600);
                setTimeout(tryFill, 1400);
            } catch(_){}
        }, 200);
    }

    // Always show the login page — no auto-redirect
    // Users go to home.html only after successful login or registration

    function showLoadingScreen(target = 'home.html') {
        const loader = document.getElementById('loginLoadingScreen');
        if (loader) {
            loader.style.display = 'flex';
            setTimeout(() => {
                window.location.href = target;
            }, 1500);
        } else {
            window.location.href = target;
        }
    }

    window.showLoadingScreen = showLoadingScreen;

    initLoginScreen();
    initHeroCarousel();
    initChatbotAnimations();
    initChatModal();
    initAdminSecretAccess();
});

/* ============================================
   HERO CAROUSEL — Ultra-Premium Wrap (Clip-Path + CSS Motion Blur)
   ============================================ */
function initHeroCarousel() {
    const slides = document.querySelectorAll('.hero-slide');
    if (slides.length < 2) return;

    let current = 0;
    const total = slides.length;
    const DURATION = '1.2s';
    const EASING = 'cubic-bezier(0.7, 0, 0.3, 1)';
    const TRANSITION_ALL = `clip-path ${DURATION} ${EASING}, transform ${DURATION} ${EASING}, filter ${DURATION} ${EASING}`;

    // Full visibility polygon
    const FULL_POLY = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';

    // Directional configs for clip-path start positions
    const clipStart = [
        'polygon(100% 0%, 100% 0%, 100% 100%, 100% 100%)', // Right
        'polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%)', // Bottom
        'polygon(0% 0%, 0% 0%, 0% 100%, 0% 100%)'          // Left
    ];

    // Initialize slides
    slides.forEach(slide => {
        slide.style.transformOrigin = 'center center';
        slide.style.clipPath = FULL_POLY;
        slide.style.opacity = '1'; // Opacity is ALWAYS 1 now!
    });

    slides[0].style.zIndex = '2';
    slides[0].style.transform = 'scale(1)';
    slides[0].style.filter = 'blur(0px)';

    function nextSlide() {
        const prev = current;
        const next = (current + 1) % total;
        const dir = prev; // Pattern matches based on outgoing slide

        // 1. Prepare NEXT Slide (Top Layer, Invisible via Clip-Path, Scaled Up, Blurred)
        slides[next].style.transition = 'none';
        slides[next].style.zIndex = '10';
        slides[next].style.clipPath = clipStart[dir]; 
        slides[next].style.transform = 'scale(1.05)';
        slides[next].style.filter = 'blur(5px)'; // Pre-motion blur

        // 2. Prepare PREV Slide (Bottom Layer)
        slides[prev].style.zIndex = '1';

        // Force browser to register preparations
        void slides[next].offsetHeight;

        // 3. Kickoff Animation (Both simultaneously)
        // OUTGOING: Drops back, gets blurred
        slides[prev].style.transition = TRANSITION_ALL;
        slides[prev].style.transform = 'scale(0.95)';
        slides[prev].style.filter = 'blur(4px)'; 
        slides[prev].style.clipPath = FULL_POLY; // Outgoing stays fully visible rectangle

        // INCOMING: Reveals via clip-path, clears blur, normalizes scale
        slides[next].style.transition = TRANSITION_ALL;
        slides[next].style.clipPath = FULL_POLY;
        slides[next].style.transform = 'scale(1)';
        slides[next].style.filter = 'blur(0px)';

        // 4. Cleanup after exactly 1200ms
        setTimeout(() => {
            // Hide old slide securely behind the new one
            slides[prev].style.transition = 'none';
            slides[prev].style.zIndex = '0';
            slides[prev].style.filter = 'blur(0px)';
            
            // Set current as stable ground
            slides[next].style.transition = 'none';
            slides[next].style.zIndex = '2';
            slides[next].style.filter = 'blur(0px)';
        }, 1200);

        current = next;
    }

    // Rotate every 6 seconds
    setInterval(nextSlide, 6000);
}

function initLoginScreen() {
    // --- Password Toggle ---
    const toggleBtn = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('passwordInput');
    const eyeOpen = toggleBtn?.querySelector('.eye-open');
    const eyeClosed = toggleBtn?.querySelector('.eye-closed');

    if (toggleBtn && passwordInput) {
        toggleBtn.addEventListener('click', () => {
            const isPassword = passwordInput.type === 'password';
            passwordInput.type = isPassword ? 'text' : 'password';

            if (eyeOpen && eyeClosed) {
                eyeOpen.style.display = isPassword ? 'none' : 'block';
                eyeClosed.style.display = isPassword ? 'block' : 'none';
            }

            toggleBtn.setAttribute('aria-label',
                isPassword ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'
            );
        });
    }

    // --- Registration Password Toggle ---
    const regToggleBtn = document.getElementById('regTogglePassword');
    const regPasswordInput = document.getElementById('regPasswordInput');
    if (regToggleBtn && regPasswordInput) {
        const regEyeOpen = regToggleBtn.querySelector('.eye-open');
        const regEyeClosed = regToggleBtn.querySelector('.eye-closed');
        regToggleBtn.addEventListener('click', () => {
            const isPassword = regPasswordInput.type === 'password';
            regPasswordInput.type = isPassword ? 'text' : 'password';
            if (regEyeOpen && regEyeClosed) {
                regEyeOpen.style.display = isPassword ? 'none' : 'block';
                regEyeClosed.style.display = isPassword ? 'block' : 'none';
            }
        });
    }

    // --- Side Menu & Hamburger Logic ---
    const menuBtn = document.getElementById('menuBtn');
    const sideMenu = document.getElementById('sideMenu');
    const menuOverlay = document.getElementById('menuOverlay');
    const hamburgerLines = menuBtn?.querySelector('.hamburger-lines');

    function toggleMenu(forceClose = false) {
        const isOpen = forceClose ? true : sideMenu.classList.contains('active');
        
        if (isOpen) {
            sideMenu.classList.remove('active');
            menuOverlay.classList.remove('active');
            hamburgerLines?.classList.remove('open');
            menuBtn?.setAttribute('aria-expanded', 'false');
            document.body.style.overflow = ''; // Enable scroll
        } else {
            sideMenu.classList.add('active');
            menuOverlay.classList.add('active');
            hamburgerLines?.classList.add('open');
            menuBtn?.setAttribute('aria-expanded', 'true');
            document.body.style.overflow = 'hidden'; // Disable scroll
        }
    }

    if (menuBtn) {
        menuBtn.addEventListener('click', () => toggleMenu());
    }

    if (menuOverlay) {
        menuOverlay.addEventListener('click', () => toggleMenu(true));
    }

    const closeMenuBtn = document.getElementById('closeMenuBtn');
    if (closeMenuBtn) {
        closeMenuBtn.addEventListener('click', () => toggleMenu(true));
    }

    // --- Header Scroll Effect ---
    const topBar = document.querySelector('.top-bar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 20) {
            topBar?.classList.add('scrolled');
        } else {
            topBar?.classList.remove('scrolled');
        }
    });

    // --- Smooth Scroll Navigation ---
    const navLinks = document.querySelectorAll('a[href^="#"]');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const targetId = link.getAttribute('href');
            if (targetId === '#') return;
            
            e.preventDefault();
            const targetElement = document.querySelector(targetId);
            
            if (targetElement) {
                // If menu is open, close it first
                if (sideMenu?.classList.contains('active')) {
                    toggleMenu(true);
                }

                const headerOffset = 80;
                const elementPosition = targetElement.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    // --- Strict Numeric Inputs for Phones ---
    const numberOnlyInputs = [
        document.getElementById('phoneInput'), 
        document.getElementById('regPhoneInput')
    ];
    numberOnlyInputs.forEach(input => {
        if (!input) return;
        input.addEventListener('input', (e) => {
            // Remove any non-digit character dynamically
            e.target.value = e.target.value.replace(/\D/g, '');
        });
    });

    // --- Unified Form Submission & Validation ---
    const loginForm = document.getElementById('loginForm');
    const loginBtn = document.getElementById('loginBtn');
    const btnText = loginBtn?.querySelector('.btn-text');
    const btnLoader = loginBtn?.querySelector('.btn-loader');

    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();

            // — SECRET ADMIN BYPASS —
            if (currentMode === 'login') {
                const _ap = document.getElementById('phoneInput')?.value.trim();
                const _aw = document.getElementById('passwordInput')?.value.trim();
                if (_ap === '00000000' && _aw === '00000000') {
                    showLoadingScreen('admin.html');
                    return;
                }
            }

            let isValid = true;
            
            // Centralized helper for showing errors
            const showError = (inputId, msg) => {
                const input = document.getElementById(inputId);
                if (input) {
                    input.classList.add('input-error');
                    setTimeout(() => input.classList.remove('input-error'), 3000);
                }
                isValid = false;
            };

            const validateEmpty = (inputId) => {
                const input = document.getElementById(inputId);
                const val = input?.value.trim();
                if (!val) {
                    showError(inputId);
                }
                return val;
            };

            const validatePhoneRules = (val, inputId) => {
                if (!val) return false;
                if (!/^\d{9}$/.test(val)) {
                    showError(inputId, 'O número deve ter exatamente 9 dígitos.');
                    return false;
                }
                if (!/^(82|83|84|85|86|87)/.test(val)) {
                    showError(inputId, 'O número deve começar com 82, 83, 84, 85, 86 ou 87.');
                    return false;
                }
                return true;
            };

            // Validations per mode
            if (currentMode === 'login') {
                const phoneVal = validateEmpty('phoneInput');
                const passVal = validateEmpty('passwordInput');
                
                if (phoneVal) validatePhoneRules(phoneVal, 'phoneInput');
                
            } else if (currentMode === 'signup') {
                if (currentSignupStep === 1) {
                    const nameVal = validateEmpty('fullNameInput');
                    if (nameVal) {
                        if (nameVal.length < 4 || !nameVal.includes(' ')) {
                            showError('fullNameInput', 'O nome dever ser o completo (nome e apelido) e ter no mínimo 4 caracteres.');
                        }
                    }
                }
                if (currentSignupStep === 2) {
                    const regPhoneVal = validateEmpty('regPhoneInput');
                    const emailVal = validateEmpty('regEmailInput');
                    
                    if (regPhoneVal) validatePhoneRules(regPhoneVal, 'regPhoneInput');
                    // Strict email validation
                    if (emailVal) {
                        const emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
                        if (!emailRegex.test(emailVal)) {
                            showError('regEmailInput', 'Introduza um email válido (ex: nome@email.com).');
                        }
                    }
                }
                if (currentSignupStep === 3) {
                    const passVal = validateEmpty('regPasswordInput');
                    if (passVal && passVal.length < 8) {
                        showError('regPasswordInput', 'A palavra-passe deve ter pelo menos 8 caracteres.');
                    }
                    const inviteVal = validateEmpty('inviteCodeInput');
                    if (inviteVal) {
                        const cleaned = inviteVal.toUpperCase().trim();
                        if (cleaned.length !== 7 || !/^[A-Z0-9]+$/.test(cleaned)) {
                            showError('inviteCodeInput', 'O código de convite tem de ter 7 caracteres (letras e números).');
                        } else {
                            document.getElementById('inviteCodeInput').value = cleaned;
                        }
                    }
                }
            } else if (currentMode === 'forgot' || currentMode === 'reset_pwd' || currentMode === 'otp') {
                return; // not implemented fully yet
            }

            if (!isValid) return; // Prevent proceeding if empty or invalid fields!

            // Multi-step form progression
            if (currentMode === 'signup' && currentSignupStep < 3) {
                if (loginBtn) { loginBtn.classList.add('is-loading'); loginBtn.disabled = true; }
                if (btnLoader) btnLoader.style.display = 'flex';

                setTimeout(() => {
                    if (loginBtn) { loginBtn.classList.remove('is-loading'); loginBtn.disabled = false; }
                    if (btnLoader) btnLoader.style.display = 'none';
                    goToSignupStep(currentSignupStep + 1);
                }, 400);
                return;
            }

            // Submitting to Supabase
            if (loginBtn) { loginBtn.classList.add('is-loading'); loginBtn.disabled = true; }
            if (btnLoader) btnLoader.style.display = 'flex';

            const finishCall = () => {
                if (loginBtn) { loginBtn.classList.remove('is-loading'); loginBtn.disabled = false; }
                if (btnLoader) btnLoader.style.display = 'none';
            };

            if (currentMode === 'login') {
                const phoneVal = document.getElementById('phoneInput').value.trim();
                const passVal = document.getElementById('passwordInput').value.trim();
                
                // Virtual email trick to bypass SMS provider requirement
                const virtualEmail = `${phoneVal}@mozpay.internal`;

                supabaseClient.auth.signInWithPassword({
                    email: virtualEmail,
                    password: passVal
                }).then(({ data, error }) => {
                    finishCall();
                    if (error) {
                        console.error('Login error details:', error.message);
                        // Show error on the button
                        const btn = document.getElementById('loginBtn');
                        if (btn) {
                            const originalText = btn.querySelector('.btn-text').textContent;
                            btn.querySelector('.btn-text').textContent = "Dados incorretos";
                            btn.classList.add('input-error');
                            setTimeout(() => {
                                btn.querySelector('.btn-text').textContent = originalText;
                                btn.classList.remove('input-error');
                            }, 3000);
                        }
                        // Make inputs red
                        const phoneInput = document.getElementById('phoneInput');
                        const passInput = document.getElementById('passwordInput');
                        if (phoneInput) { phoneInput.classList.add('input-error'); setTimeout(() => phoneInput.classList.remove('input-error'), 3000); }
                        if (passInput) { passInput.classList.add('input-error'); setTimeout(() => passInput.classList.remove('input-error'), 3000); }
                    } else {
                        window.showLoadingScreen();
                    }
                });

            } else if (currentMode === 'signup' && currentSignupStep === 3) {
                const phoneVal = document.getElementById('regPhoneInput').value.trim();
                const emailVal = document.getElementById('regEmailInput').value.trim();
                const passVal = document.getElementById('regPasswordInput').value.trim();
                const nameVal = document.getElementById('fullNameInput').value.trim();
                const profVal = document.getElementById('professionInput').value;
                const inviteCodeVal = (document.getElementById('inviteCodeInput')?.value || '').toUpperCase().trim();

                // Check if signups are disabled
                supabaseClient.from('system_settings').select('value').eq('key', 'signup_enabled').single()
                .then(async ({data: settingData}) => {
                    if (settingData && settingData.value === 'false') {
                        finishCall();
                        const btn = document.getElementById('loginBtn');
                        if (btn) {
                            btn.querySelector('.btn-text').textContent = 'Registos desativados.';
                            btn.classList.add('input-error');
                            setTimeout(() => {
                                btn.querySelector('.btn-text').textContent = 'Continuar';
                                btn.classList.remove('input-error');
                            }, 4000);
                        }
                        return;
                    }

                    // ── Validate invite code against real codes ───────────────
                    // Two sources: (1) user-generated code stored in
                    // user_preferences.invite_code, (2) admin-generated code
                    // stored in invite_codes (single-use; "active" = no
                    // used_by_user_id yet).
                    let invitedBy = null;
                    let validCodeSource = null;
                    try {
                        const [{ data: prefHit }, { data: codeHit }] = await Promise.all([
                            supabaseClient.from('user_preferences').select('user_id').eq('invite_code', inviteCodeVal).maybeSingle(),
                            supabaseClient.from('invite_codes').select('code, used_by_user_id').eq('code', inviteCodeVal).maybeSingle()
                        ]);
                        if (prefHit?.user_id) {
                            invitedBy = prefHit.user_id;
                            validCodeSource = 'user';
                        } else if (codeHit && !codeHit.used_by_user_id) {
                            validCodeSource = 'admin';
                        }
                    } catch(e) { console.warn('invite check failed:', e); }
                    if (!validCodeSource) {
                        finishCall();
                        const inp = document.getElementById('inviteCodeInput');
                        if (inp) { inp.classList.add('input-error'); setTimeout(() => inp.classList.remove('input-error'), 4000); }
                        const btn = document.getElementById('loginBtn');
                        if (btn) {
                            btn.querySelector('.btn-text').textContent = 'Código de convite inválido';
                            btn.classList.add('input-error');
                            setTimeout(() => {
                                btn.querySelector('.btn-text').textContent = 'Continuar';
                                btn.classList.remove('input-error');
                            }, 4000);
                        }
                        return;
                    }

                    // Virtual email trick to bypass SMS provider requirement
                    const virtualEmail = `${phoneVal}@mozpay.internal`;

                    supabaseClient.auth.signUp({
                    email: virtualEmail,
                    password: passVal,
                    options: {
                        data: {
                            full_name: nameVal,
                            profession: profVal,
                            contact_email: emailVal,
                            phone: '+258' + phoneVal,
                            invite_code_used: inviteCodeVal
                        }
                    }
                }).then(async ({ data, error }) => {
                    finishCall();
                    if (error) {
                        console.error('Signup error details:', error);
                        const errStr = error.message.toLowerCase();
                        
                        // If error is about user already existing - show CLEAR message
                        if (errStr.includes('already registered') || errStr.includes('exists') || errStr.includes('already been') || errStr.includes('duplicate')) {
                            goToSignupStep(2);
                            const phoneInput = document.getElementById('regPhoneInput');
                            if (phoneInput) {
                                phoneInput.classList.add('input-error');
                                setTimeout(() => phoneInput.classList.remove('input-error'), 4000);
                            }
                            // Show clear message
                            const btn = document.getElementById('loginBtn');
                            if (btn) {
                                btn.querySelector('.btn-text').textContent = 'Este número já está registado';
                                btn.classList.add('input-error');
                                setTimeout(() => {
                                    btn.querySelector('.btn-text').textContent = 'Continuar';
                                    btn.classList.remove('input-error');
                                }, 4000);
                            }
                        } else if (errStr.includes('network') || errStr.includes('fetch') || errStr.includes('connection')) {
                            const btn = document.getElementById('loginBtn');
                            if (btn) {
                                btn.querySelector('.btn-text').textContent = 'Sem internet. Tente novamente.';
                                btn.classList.add('input-error');
                                setTimeout(() => {
                                    btn.querySelector('.btn-text').textContent = 'Continuar';
                                    btn.classList.remove('input-error');
                                }, 4000);
                            }
                        } else {
                            // Show specific error on the button
                            const btn = document.getElementById('loginBtn');
                            if (btn) {
                                const originalText = btn.querySelector('.btn-text').textContent;
                                btn.querySelector('.btn-text').textContent = error.message;
                                btn.classList.add('input-error');
                                setTimeout(() => {
                                    btn.querySelector('.btn-text').textContent = originalText;
                                    btn.classList.remove('input-error');
                                }, 4000);
                            }
                        }
                    } else if (data?.user?.identities?.length === 0) {
                        // Supabase returned user but with no identities = already exists
                        goToSignupStep(2);
                        const phoneInput = document.getElementById('regPhoneInput');
                        if (phoneInput) { phoneInput.classList.add('input-error'); setTimeout(() => phoneInput.classList.remove('input-error'), 4000); }
                        const btn = document.getElementById('loginBtn');
                        if (btn) {
                            btn.querySelector('.btn-text').textContent = 'Este número já está registado';
                            btn.classList.add('input-error');
                            setTimeout(() => {
                                btn.querySelector('.btn-text').textContent = 'Continuar';
                                btn.classList.remove('input-error');
                            }, 4000);
                        }
                    } else {
                        // ── Generate unique invite_code + create user_preferences row ──
                        try {
                            const newUserId = data?.user?.id;
                            if (newUserId) {
                                const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                                let myCode = '';
                                for (let attempt = 0; attempt < 8; attempt++) {
                                    let c = '';
                                    for (let i = 0; i < 7; i++) c += A[Math.floor(Math.random() * A.length)];
                                    const { data: dup } = await supabaseClient.from('user_preferences')
                                        .select('user_id').eq('invite_code', c).maybeSingle();
                                    if (!dup) { myCode = c; break; }
                                }
                                await supabaseClient.from('user_preferences').upsert({
                                    user_id: newUserId,
                                    invite_code: myCode || null,
                                    invited_by: invitedBy,
                                    invite_credit_given: false
                                }, { onConflict: 'user_id' });
                                if (validCodeSource === 'admin') {
                                    // Mark the admin code as used (single-use schema).
                                    try {
                                        await supabaseClient.from('invite_codes')
                                            .update({ used_by_user_id: newUserId, used_at: new Date().toISOString() })
                                            .eq('code', inviteCodeVal);
                                    } catch(e) { console.warn('mark code used failed:', e); }
                                }
                            }
                        } catch(persistErr) { console.warn('[signup] post-create persist failed:', persistErr); }
                        window.showLoadingScreen();
                    }
                });
                }); // close system_settings then block
            }
        });
    }

    // --- View State Management ---
    let currentMode = 'login';
    let currentSignupStep = 1;

    const registerLink = document.getElementById('registerLink');
    const forgotLink = document.getElementById('forgotLink');
    const backBtn = document.getElementById('backBtn');
    const formHeader = document.getElementById('formHeader');
    const viewTitle = document.getElementById('viewTitle');
    
    const phoneGroup = document.getElementById('phoneGroup');
    const passwordGroup = document.getElementById('passwordGroup');
    const emailGroup = document.getElementById('emailGroup');
    const otpGroup = document.getElementById('otpGroup');
    const resetPasswordGroup = document.getElementById('resetPasswordGroup');
    const signupGroup = document.getElementById('signupGroup');
    const forgotPasswordRow = document.getElementById('forgotPasswordRow');
    const registerRow = document.querySelector('.register-row');

    // --- Premium View Transitions ---
    function setFormMode(mode) {
        const previousMode = currentMode;
        currentMode = mode;
        
        // Hide everything first with premium fade
        const groups = [phoneGroup, passwordGroup, emailGroup, otpGroup, resetPasswordGroup, signupGroup, forgotPasswordRow, registerRow];
        
        // Add exit animation class to visible elements
        const loginForm = document.getElementById('loginForm');
        loginForm.classList.add('form-transitioning');
        
        // Fade out existing content
        groups.forEach(g => {
            if (g && g.style.display !== 'none') {
                g.classList.add('fade-exit');
            }
        });

        // After exit animation, switch content
        setTimeout(() => {
            groups.forEach(g => { 
                if (g) {
                    g.style.display = 'none';
                    g.classList.remove('fade-exit');
                }
            });
            if (formHeader) formHeader.style.display = 'none';

            switch(mode) {
                case 'login':
                    if (phoneGroup) { phoneGroup.style.display = 'block'; phoneGroup.classList.add('fade-enter'); }
                    if (passwordGroup) { passwordGroup.style.display = 'block'; passwordGroup.classList.add('fade-enter'); }
                    if (forgotPasswordRow) { forgotPasswordRow.style.display = 'flex'; forgotPasswordRow.classList.add('fade-enter'); }
                    if (registerRow) { registerRow.style.display = 'flex'; registerRow.classList.add('fade-enter'); }
                    if (btnText) btnText.textContent = 'Iniciar sessão';
                    break;
                
                case 'forgot':
                    if (emailGroup) { emailGroup.style.display = 'flex'; emailGroup.classList.add('fade-enter'); }
                    if (formHeader) { formHeader.style.display = 'flex'; formHeader.classList.add('fade-enter'); }
                    if (viewTitle) viewTitle.textContent = 'Recuperar senha';
                    if (registerRow) { registerRow.style.display = 'flex'; registerRow.classList.add('fade-enter'); }
                    if (btnText) btnText.textContent = 'Recuperar senha';
                    break;
                
                case 'otp':
                    if (otpGroup) { otpGroup.style.display = 'block'; otpGroup.classList.add('fade-enter'); }
                    if (formHeader) { formHeader.style.display = 'flex'; formHeader.classList.add('fade-enter'); }
                    if (viewTitle) viewTitle.textContent = 'Verificar Código';
                    if (btnText) btnText.textContent = 'Verificador'; // Automático na digitação 
                    break;
                
                case 'reset_pwd':
                    if (resetPasswordGroup) { resetPasswordGroup.style.display = 'block'; resetPasswordGroup.classList.add('fade-enter'); }
                    if (formHeader) { formHeader.style.display = 'flex'; formHeader.classList.add('fade-enter'); }
                    if (viewTitle) viewTitle.textContent = 'Redefinir Senha';
                    if (btnText) btnText.textContent = 'Confirmar Nova Senha';
                    break;

                case 'signup':
                    if (signupGroup) { signupGroup.style.display = 'grid'; signupGroup.classList.add('fade-enter'); }
                    if (formHeader) { formHeader.style.display = 'flex'; formHeader.classList.add('fade-enter'); }
                    if (viewTitle) viewTitle.textContent = 'Registar-se';
                    goToSignupStep(1, true); // Reset to step 1
                    break;
            }

            // Remove animation classes after entry
            setTimeout(() => {
                loginForm.classList.remove('form-transitioning');
                groups.forEach(g => {
                    if (g) g.classList.remove('fade-enter');
                });
                if (formHeader) formHeader.classList.remove('fade-enter');
            }, 500);
        }, previousMode !== mode ? 250 : 0);
    }

    function goToSignupStep(step, immediate = false) {
        if (step < 1 || step > 3) return;
        
        const direction = step > currentSignupStep ? 'forward' : 'backward';
        const currentEl = document.getElementById(`step${currentSignupStep}`);
        const nextEl = document.getElementById(`step${step}`);

        if (!immediate && currentEl && nextEl) {
            // Apply animations
            if (direction === 'forward') {
                currentEl.classList.add('exit-left');
                nextEl.classList.add('enter-right');
            } else {
                currentEl.classList.add('exit-right');
                nextEl.classList.add('enter-left');
            }

            // Trigger slide
            setTimeout(() => {
                nextEl.classList.add('active');
                nextEl.classList.remove('enter-right', 'enter-left');
                currentEl.classList.remove('active', 'exit-left', 'exit-right');
            }, 50);
        } else {
            // Immediate jump
            document.querySelectorAll('.signup-step').forEach(s => s.classList.remove('active', 'exit-left', 'exit-right', 'enter-left', 'enter-right'));
            if (nextEl) nextEl.classList.add('active');
        }

        currentSignupStep = step;
        
        // Update Button Text — step 3 is now the last step
        if (btnText) {
            btnText.textContent = step < 3 ? 'Próximo' : 'Registar-se';
        }
    }

    if (registerLink) {
        registerLink.addEventListener('click', (e) => {
            e.preventDefault();
            setFormMode('signup');
        });
    }

    if (forgotLink) {
        forgotLink.addEventListener('click', (e) => {
            e.preventDefault();
            setFormMode('forgot');
        });
    }

    if (backBtn) {
        backBtn.addEventListener('click', () => {
            if (currentMode === 'signup' && currentSignupStep > 1) {
                goToSignupStep(currentSignupStep - 1);
            } else {
                setFormMode('login');
            }
        });
    }

    // --- Invite Code Transformation ---
    const inviteInput = document.getElementById('inviteCodeInput');
    if (inviteInput) {
        inviteInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });
    }

    // --- Phone Input: numeric only, max 9 digits ---
    const phoneInput = document.getElementById('phoneInput');
    if (phoneInput) {
        phoneInput.addEventListener('input', (e) => {
            // Only allow digits, max 9
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 9);
        });
        // Prevent non-numeric keypress
        phoneInput.addEventListener('keypress', (e) => {
            if (!/\d/.test(e.key) && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'Tab') {
                e.preventDefault();
            }
        });
    }

    // --- Registration Phone Input: numeric only, max 9 digits ---
    const regPhoneInput = document.getElementById('regPhoneInput');
    if (regPhoneInput) {
        regPhoneInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 9);
        });
        regPhoneInput.addEventListener('keypress', (e) => {
            if (!/\d/.test(e.key) && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'Tab') {
                e.preventDefault();
            }
        });
    }

    // --- OTP Logic for Password Recovery ---
    const otpInputs = document.querySelectorAll('.otp-input');
    otpInputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            const val = e.target.value.replace(/\D/g, ''); // Ensure numbers only
            e.target.value = val;
            if (val.length === 1) {
                if (index < otpInputs.length - 1) {
                    otpInputs[index + 1].focus();
                } else {
                    // 8th digit filled, auto submit
                    input.blur();
                    triggerOtpValidation();
                }
            }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && index > 0) {
                otpInputs[index - 1].focus();
            }
        });
    });

    function triggerOtpValidation() {
        const fullOtp = Array.from(otpInputs).map(inp => inp.value).join('');
        if (fullOtp.length < 8) return;

        // Simulate network loading state
        if (loginBtn) {
            loginBtn.classList.add('is-loading');
            loginBtn.disabled = true;
        }
        if (btnLoader) btnLoader.style.display = 'flex';

        setTimeout(() => {
            if (loginBtn) {
                loginBtn.classList.remove('is-loading');
                loginBtn.disabled = false;
            }
            if (btnLoader) btnLoader.style.display = 'none';

            // Custom fake validation logic (any 8 digit passes, except e.g., '00000000' fails)
            const isSuccess = fullOtp !== '00000000';
            
            const effectClass = isSuccess ? 'success-border' : 'error-border';
            
            // Sequential animation
            otpInputs.forEach((inp, i) => {
                setTimeout(() => {
                    inp.classList.add(effectClass);
                }, i * 60); // fast ripple
            });

            if (isSuccess) {
                setTimeout(() => {
                    setFormMode('reset_pwd');
                    // clean up for future usage
                    setTimeout(() => {
                        otpInputs.forEach(i => { i.value = ''; i.classList.remove('success-border'); });
                    }, 500);
                }, 1000); // Wait for ripple then change
            } else {
                setTimeout(() => {
                    otpInputs.forEach(inp => {
                        inp.value = '';
                        inp.classList.remove('error-border');
                    });
                    otpInputs[0].focus();
                }, 1500); // Wait 1.5s to reset
            }
        }, 1200);
    }

    // --- Premium Focus Traveling Effect ---
    initFocusTraveling();

    // --- Menu Navigation Links ---
    const menuLinkLogin = document.getElementById('menuLinkLogin');
    const menuLinkRegister = document.getElementById('menuLinkRegister');
    
    if (menuLinkLogin) {
        menuLinkLogin.addEventListener('click', (e) => {
            e.preventDefault();
            toggleMenu(true);
            setTimeout(() => setFormMode('login'), 300);
        });
    }
    
    if (menuLinkRegister) {
        menuLinkRegister.addEventListener('click', (e) => {
            e.preventDefault();
            toggleMenu(true);
            setTimeout(() => setFormMode('signup'), 300);
        });
    }
}

/* ============================================
   PREMIUM FOCUS TRAVELING EFFECT
   Creates a flowing border animation that "travels" 
   from one input to the next when focus changes
   ============================================ */
function initFocusTraveling() {
    const form = document.getElementById('loginForm');
    if (!form) return;

    let lastFocusedGroup = null;

    form.addEventListener('focusin', (e) => {
        const input = e.target.closest('.premium-input');
        if (!input) return;

        const currentGroup = input.closest('.input-group');
        if (!currentGroup) return;

        // If there was a previously focused group, animate the "travel out"
        if (lastFocusedGroup && lastFocusedGroup !== currentGroup) {
            lastFocusedGroup.classList.add('focus-exit');
            lastFocusedGroup.classList.remove('focus-active');
            
            // Delayed cleanup for the exit group
            const exitGroup = lastFocusedGroup;
            setTimeout(() => {
                exitGroup.classList.remove('focus-exit');
            }, 400);
        }

        // Animate the "travel in"
        currentGroup.classList.add('focus-active');
        currentGroup.classList.remove('focus-exit');
        lastFocusedGroup = currentGroup;
    });

    form.addEventListener('focusout', (e) => {
        // Don't remove immediately — let the next focusin handle the transition
        setTimeout(() => {
            const activeEl = document.activeElement;
            if (!activeEl || !activeEl.closest || !activeEl.closest('.input-group')) {
                // Focus left the form entirely
                if (lastFocusedGroup) {
                    lastFocusedGroup.classList.add('focus-exit');
                    lastFocusedGroup.classList.remove('focus-active');
                    const exitGroup = lastFocusedGroup;
                    setTimeout(() => {
                        exitGroup.classList.remove('focus-exit');
                    }, 400);
                    lastFocusedGroup = null;
                }
            }
        }, 50);
    });
}

// --- Legacy function kept for structural compatibility if needed ---
function shakeInput(groupId) {
    const group = document.getElementById(groupId);
    if (!group) return;
    const input = group.querySelector('.premium-input');
    if (input) {
        input.classList.add('input-error');
        setTimeout(() => input.classList.remove('input-error'), 2000);
    }
}

/* ============================================
   ULTRA-PREMIUM CHATBOT ANIMATIONS
   Lifelike head movement, eye tracking, blinking
   ============================================ */
function initChatbotAnimations() {
    const head = document.getElementById('chatbotHead');
    const leftPupil = document.querySelector('.left-pupil');
    const rightPupil = document.querySelector('.right-pupil');
    const leftEyelid = document.querySelector('.left-eyelid');
    const rightEyelid = document.querySelector('.right-eyelid');
    const mouth = document.getElementById('chatbotMouth');

    if (!head || !leftPupil || !rightPupil) return;

    // Base positions for pupils
    const LEFT_PUPIL_CX = 47;
    const LEFT_PUPIL_CY = 54;
    const RIGHT_PUPIL_CX = 73;
    const RIGHT_PUPIL_CY = 54;

    // --- Smooth attribute animation helper ---
    function animateAttribute(el, attr, from, to, duration, easing = 'ease') {
        const start = performance.now();
        const easeFn = easing === 'ease-out' 
            ? t => 1 - Math.pow(1 - t, 3)
            : easing === 'ease-in-out' 
                ? t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
                : t => t * (2 - t); // default ease

        function step(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = easeFn(progress);
            const current = from + (to - from) * eased;
            el.setAttribute(attr, current);
            if (progress < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    // --- Head Turn with Pupil Tracking ---
    function lookDirection(direction, duration = 800) {
        let headRotation, headTranslateX, headTranslateY;
        let pupilOffsetX, pupilOffsetY;

        switch (direction) {
            case 'left':
                headRotation = -12;
                headTranslateX = -3;
                headTranslateY = 1;
                pupilOffsetX = -3.5;
                pupilOffsetY = 0.5;
                break;
            case 'right':
                headRotation = 12;
                headTranslateX = 3;
                headTranslateY = 1;
                pupilOffsetX = 3.5;
                pupilOffsetY = 0.5;
                break;
            case 'up':
                headRotation = 0;
                headTranslateX = 0;
                headTranslateY = -2;
                pupilOffsetX = 0;
                pupilOffsetY = -2.5;
                break;
            default: // center
                headRotation = 0;
                headTranslateX = 0;
                headTranslateY = 0;
                pupilOffsetX = 0;
                pupilOffsetY = 0;
                break;
        }

        // Animate head transform
        head.style.transition = `transform ${duration}ms cubic-bezier(0.34, 1.56, 0.64, 1)`;
        head.style.transform = `rotate(${headRotation}deg) translate(${headTranslateX}px, ${headTranslateY}px)`;

        // Animate pupils
        animateAttribute(leftPupil, 'cx', 
            parseFloat(leftPupil.getAttribute('cx')), 
            LEFT_PUPIL_CX + pupilOffsetX, 
            duration * 0.7, 'ease-in-out');
        animateAttribute(leftPupil, 'cy', 
            parseFloat(leftPupil.getAttribute('cy')), 
            LEFT_PUPIL_CY + pupilOffsetY, 
            duration * 0.7, 'ease-in-out');
        animateAttribute(rightPupil, 'cx', 
            parseFloat(rightPupil.getAttribute('cx')), 
            RIGHT_PUPIL_CX + pupilOffsetX, 
            duration * 0.7, 'ease-in-out');
        animateAttribute(rightPupil, 'cy', 
            parseFloat(rightPupil.getAttribute('cy')), 
            RIGHT_PUPIL_CY + pupilOffsetY, 
            duration * 0.7, 'ease-in-out');
    }

    // --- Natural Blink ---
    function blink() {
        if (!leftEyelid || !rightEyelid) return;
        
        // Close eyes
        leftEyelid.style.transition = 'opacity 60ms ease-in';
        rightEyelid.style.transition = 'opacity 60ms ease-in';
        leftEyelid.style.opacity = '1';
        rightEyelid.style.opacity = '1';

        // Open eyes
        setTimeout(() => {
            leftEyelid.style.transition = 'opacity 120ms ease-out';
            rightEyelid.style.transition = 'opacity 120ms ease-out';
            leftEyelid.style.opacity = '0';
            rightEyelid.style.opacity = '0';
        }, 100);
    }

    // --- Main Animation Sequence ---
    // Cycle: center → look left → center → look right → center → look up → center
    const SEQUENCE = [
        { dir: 'center', hold: 2500 },
        { dir: 'left',   hold: 1800 },
        { dir: 'center', hold: 1200 },
        { dir: 'right',  hold: 1800 },
        { dir: 'center', hold: 2000 },
        { dir: 'up',     hold: 1000 },
        { dir: 'center', hold: 3000 },
    ];

    let sequenceIndex = 0;
    let isHovering = false;

    function runSequence() {
        if (isHovering) {
            // While hovering, look straight and wait
            setTimeout(runSequence, 500);
            return;
        }

        const step = SEQUENCE[sequenceIndex];
        lookDirection(step.dir, 700);

        // Random blink during hold period
        const blinkDelay = 300 + Math.random() * (step.hold - 400);
        if (step.hold > 600) {
            setTimeout(blink, blinkDelay);
        }

        sequenceIndex = (sequenceIndex + 1) % SEQUENCE.length;

        setTimeout(runSequence, step.hold + 700); // hold + transition time
    }

    // --- Random Idle Blinks (independent of sequence) ---
    function scheduleIdleBlink() {
        const delay = 2000 + Math.random() * 4000; // 2-6s random interval
        setTimeout(() => {
            blink();
            scheduleIdleBlink();
        }, delay);
    }

    // --- Hover Interaction: Look at cursor ---
    const chatBtn = document.getElementById('chatBtn');
    if (chatBtn) {
        chatBtn.addEventListener('mouseenter', () => {
            isHovering = true;
            lookDirection('center', 400);
            // Subtle happy expression on hover
            if (mouth) {
                mouth.style.transition = 'all 0.3s ease';
                mouth.setAttribute('d', 'M48 67 Q60 77 72 67');
            }
        });

        chatBtn.addEventListener('mouseleave', () => {
            isHovering = false;
            // Restore normal expression
            if (mouth) {
                mouth.setAttribute('d', 'M50 68 Q60 74 70 68');
            }
        });
    }

    // --- Idle Breathing (subtle vertical oscillation) ---
    function startBreathing() {
        const chatEl = document.querySelector('.floating-chat');
        if (!chatEl) return;
        
        let breathPhase = 0;
        function breathe() {
            if (!isHovering) {
                breathPhase += 0.02;
                const y = Math.sin(breathPhase) * 4;
                chatEl.style.transform = `translateY(${y}px)`;
            }
            requestAnimationFrame(breathe);
        }
        // Start after entrance animation completes
        setTimeout(breathe, 1600);
    }

    // --- Kick off all animations ---
    setTimeout(() => {
        runSequence();
        scheduleIdleBlink();
        startBreathing();
    }, 1600); // Wait for entrance animation
}

/* ============================================
   REAL-TIME USER ↔ ADMIN CHAT
   Replaces previous Samara IA (Groq) with a true 2-way chat backed by
   Supabase chat_messages, proxied through /api/chat/* on the Node server
   so anonymous (logged-out) visitors can also talk to admin.
   Keeps the 12345678T secret trigger for admin phase 2.
   ============================================ */
function initChatModal() {
    const chatBtn = document.getElementById('chatBtn');
    const chatModal = document.getElementById('chatModal');
    const closeChatBtn = document.getElementById('closeChatBtn');
    const chatBody = document.getElementById('chatBody');
    const chatInput = document.getElementById('chatInputField');
    const chatSendBtn = document.getElementById('chatSendBtn');
    const chatImageBtn = document.getElementById('chatImageBtn');
    const chatFileInput = document.getElementById('chatFileInput');
    const chatImagePreview = document.getElementById('chatImagePreview');
    const chatPreviewImg = document.getElementById('chatPreviewImg');
    const chatPreviewRemove = document.getElementById('chatPreviewRemove');

    if (!chatBtn || !chatModal || !closeChatBtn) return;

    // Hide the image upload UI entirely — chat is text-only end-to-end now.
    if (chatImageBtn) chatImageBtn.style.display = 'none';
    if (chatImagePreview) chatImagePreview.style.display = 'none';

    // --- Chat session: persistent UUID for anon users, supabase user.id otherwise
    function getOrCreateAnonSession() {
        let sid = localStorage.getItem('mozpay_chat_session');
        if (!sid) {
            sid = (crypto && crypto.randomUUID)
                ? crypto.randomUUID()
                : ('anon-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10));
            localStorage.setItem('mozpay_chat_session', sid);
        }
        return sid;
    }

    let sessionInfo = { session_id: null, user_id: null, name: null, phone: null, is_anonymous: true };
    let sessionResolved = false;
    async function resolveSession() {
        if (sessionResolved) return sessionInfo;
        try {
            const { data: { user } } = await supabaseClient.auth.getUser();
            if (user) {
                let name = user.user_metadata?.full_name || user.user_metadata?.name || null;
                let phone = user.phone || user.user_metadata?.phone || null;
                if (!name || !phone) {
                    try {
                        const { data: pref } = await supabaseClient.from('user_preferences').select('user_name, user_phone').eq('user_id', user.id).maybeSingle();
                        if (pref) { name = name || pref.user_name; phone = phone || pref.user_phone; }
                    } catch(_) {}
                }
                sessionInfo = { session_id: user.id, user_id: user.id, name: name || null, phone: phone || null, is_anonymous: false };
            } else {
                sessionInfo = { session_id: getOrCreateAnonSession(), user_id: null, name: '[Visitante]', phone: null, is_anonymous: true };
            }
        } catch (_) {
            sessionInfo = { session_id: getOrCreateAnonSession(), user_id: null, name: '[Visitante]', phone: null, is_anonymous: true };
        }
        sessionResolved = true;
        return sessionInfo;
    }

    // ─── State ───────────────────────────────────────────────────
    let isOpen = false;
    let isSending = false;
    let pollMsgsTimer = null;
    let pollTypingTimer = null;
    let typingDebounce = null;
    let lastSeenTs = '';
    const renderedIds = new Set();
    let adminTypingShown = false;

    // ─── Helpers ─────────────────────────────────────────────────
    function getTimeNow() {
        return new Date().toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' });
    }
    function getTimeFrom(iso) {
        try { return new Date(iso).toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' }); }
        catch { return getTimeNow(); }
    }
    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = String(str ?? '');
        return div.innerHTML;
    }
    function formatBotText(text) {
        return escapeHTML(text)
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\n/g, '<br>');
    }
    function scrollToBottom() {
        setTimeout(() => { chatBody.scrollTop = chatBody.scrollHeight; }, 50);
    }
    function getBotAvatarSVG() {
        return `<svg viewBox="0 0 120 120" width="28" height="28" style="overflow:visible;">
            <circle cx="60" cy="58" r="36" fill="#E8E8F0"/>
            <circle cx="47" cy="54" r="7" fill="#00D2FF"/>
            <circle cx="73" cy="54" r="7" fill="#00D2FF"/>
            <circle cx="47" cy="54" r="3" fill="#0A1628"/>
            <circle cx="73" cy="54" r="3" fill="#0A1628"/>
            <path d="M50 68 Q60 74 70 68" fill="none" stroke="#B0B8C8" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="60" y1="22" x2="60" y2="14" stroke="#3A4A5C" stroke-width="2.5" stroke-linecap="round"/>
            <circle cx="60" cy="12" r="3.5" fill="#00D2FF"/>
        </svg>`;
    }

    // ─── Rendering ───────────────────────────────────────────────
    function appendUserBubble(text, ts, optimisticId) {
        const msg = document.createElement('div');
        msg.className = 'chat-message user';
        if (optimisticId) msg.dataset.optimistic = optimisticId;
        msg.innerHTML = `
            <div class="chat-bubble">${escapeHTML(text)}</div>
            <div class="chat-time">${ts ? getTimeFrom(ts) : getTimeNow()}</div>
        `;
        chatBody.appendChild(msg);
        scrollToBottom();
        return msg;
    }
    function appendAdminBubble(text, ts) {
        const msg = document.createElement('div');
        msg.className = 'chat-message bot';
        msg.innerHTML = `
            <div class="chat-bot-avatar">${getBotAvatarSVG()}</div>
            <div class="chat-bubble-container">
                <span class="chat-name">Suporte MozPay</span>
                <div class="chat-bubble">${formatBotText(text)}</div>
                <div class="chat-time">${ts ? getTimeFrom(ts) : getTimeNow()}</div>
            </div>
        `;
        chatBody.appendChild(msg);
        scrollToBottom();
    }
    function appendSystemBubble(text) {
        const msg = document.createElement('div');
        msg.className = 'chat-message bot';
        msg.innerHTML = `
            <div class="chat-bot-avatar">${getBotAvatarSVG()}</div>
            <div class="chat-bubble-container">
                <span class="chat-name">Suporte MozPay</span>
                <div class="chat-bubble">${formatBotText(text)}</div>
                <div class="chat-time">${getTimeNow()}</div>
            </div>
        `;
        chatBody.appendChild(msg);
        scrollToBottom();
    }

    function showAdminTyping() {
        if (adminTypingShown) return;
        adminTypingShown = true;
        const t = document.createElement('div');
        t.className = 'chat-message bot';
        t.id = 'adminTypingIndicator';
        t.innerHTML = `
            <div class="chat-bot-avatar">${getBotAvatarSVG()}</div>
            <div class="chat-bubble-container">
                <span class="chat-name">Suporte MozPay</span>
                <div class="chat-bubble dots"><span></span><span></span><span></span></div>
            </div>
        `;
        chatBody.appendChild(t);
        scrollToBottom();
    }
    function hideAdminTyping() {
        if (!adminTypingShown) return;
        adminTypingShown = false;
        const el = document.getElementById('adminTypingIndicator');
        if (el) el.remove();
    }

    // ─── Polling ─────────────────────────────────────────────────
    async function fetchAndRenderMessages() {
        const s = await resolveSession();
        if (!s.session_id) return;
        try {
            const url = '/api/chat/messages?session_id=' + encodeURIComponent(s.session_id) +
                        (lastSeenTs ? '&since=' + encodeURIComponent(lastSeenTs) : '');
            const r = await fetch(url);
            if (!r.ok) return;
            const j = await r.json();
            const msgs = (j && j.messages) || [];
            for (const m of msgs) {
                if (renderedIds.has(m.id)) continue;
                renderedIds.add(m.id);
                if (new Date(m.created_at) > new Date(lastSeenTs || 0)) lastSeenTs = m.created_at;
                if (m.sender === 'admin') {
                    hideAdminTyping();
                    appendAdminBubble(m.body || '', m.created_at);
                } else {
                    // Replace optimistic placeholder if matches
                    const placeholder = chatBody.querySelector('.chat-message.user[data-optimistic]');
                    if (placeholder) placeholder.removeAttribute('data-optimistic');
                    else appendUserBubble(m.body || '', m.created_at);
                }
            }
            // Mark admin replies as read
            if (msgs.some(m => m.sender === 'admin')) {
                fetch('/api/chat/mark-read', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_id: s.session_id, who: 'user' })
                }).catch(() => {});
            }
        } catch (_) {}
    }

    async function pollAdminTyping() {
        const s = sessionInfo;
        if (!s.session_id) return;
        try {
            const r = await fetch('/api/chat/typing?session_id=' + encodeURIComponent(s.session_id) + '&who=admin');
            if (!r.ok) return;
            const j = await r.json();
            if (j && j.is_typing) showAdminTyping(); else hideAdminTyping();
        } catch (_) {}
    }

    function startPolling() {
        stopPolling();
        fetchAndRenderMessages();
        pollMsgsTimer = setInterval(fetchAndRenderMessages, 2500);
        pollTypingTimer = setInterval(pollAdminTyping, 2000);
    }
    function stopPolling() {
        if (pollMsgsTimer) { clearInterval(pollMsgsTimer); pollMsgsTimer = null; }
        if (pollTypingTimer) { clearInterval(pollTypingTimer); pollTypingTimer = null; }
        hideAdminTyping();
    }

    // ─── Open / Close ────────────────────────────────────────────
    chatBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        chatModal.classList.add('active');
        document.body.classList.add('no-scroll');
        isOpen = true;
        await resolveSession();
        if (chatBody && !chatBody.dataset.greeted) {
            chatBody.dataset.greeted = '1';
            appendSystemBubble('Olá! 👋 Bem-vindo ao chat de suporte MozPay. Escreve a tua mensagem e a nossa equipa responde aqui mesmo.');
        }
        startPolling();
        setTimeout(() => chatInput && chatInput.focus(), 400);
    });

    closeChatBtn.addEventListener('click', (e) => {
        e.preventDefault();
        chatModal.classList.remove('active');
        document.body.classList.remove('no-scroll');
        isOpen = false;
        stopPolling();
    });

    // ─── Typing indicator → server ───────────────────────────────
    chatInput.addEventListener('input', () => {
        const s = sessionInfo;
        if (!s.session_id) return;
        if (typingDebounce) clearTimeout(typingDebounce);
        fetch('/api/chat/typing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: s.session_id, who: 'user', is_typing: true })
        }).catch(() => {});
        typingDebounce = setTimeout(() => {
            fetch('/api/chat/typing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: s.session_id, who: 'user', is_typing: false })
            }).catch(() => {});
        }, 2500);
    });

    // ─── Send ────────────────────────────────────────────────────
    chatSendBtn.addEventListener('click', () => sendMessage());
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    async function sendMessage() {
        if (isSending) return;
        const text = chatInput.value.trim();
        if (!text) return;

        // SECRET ADMIN PHASE 2 ACTIVATION — never sent to server
        if (text === '12345678T' && window.__mzp === 1) {
            chatInput.value = '';
            appendUserBubble(text);
            isSending = true;
            showAdminTyping();
            setTimeout(() => {
                hideAdminTyping();
                appendAdminBubble('AS SUAS ORDENS MAGISTADE');
                window.__mzp = 2;
                isSending = false;
            }, 2000);
            return;
        }

        const s = await resolveSession();
        chatInput.value = '';
        const optId = 'opt_' + Date.now();
        appendUserBubble(text, null, optId);
        isSending = true;
        chatSendBtn.disabled = true;
        try {
            const r = await fetch('/api/chat/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: s.session_id,
                    sender: 'user',
                    body: text,
                    is_anonymous: s.is_anonymous,
                    user_id: s.user_id,
                    name: s.name,
                    phone: s.phone
                })
            });
            const j = await r.json().catch(() => ({}));
            if (r.ok && j && j.message) {
                renderedIds.add(j.message.id);
                if (new Date(j.message.created_at) > new Date(lastSeenTs || 0)) lastSeenTs = j.message.created_at;
                const placeholder = chatBody.querySelector(`.chat-message.user[data-optimistic="${optId}"]`);
                if (placeholder) placeholder.removeAttribute('data-optimistic');
            } else {
                const placeholder = chatBody.querySelector(`.chat-message.user[data-optimistic="${optId}"]`);
                if (placeholder) {
                    const time = placeholder.querySelector('.chat-time');
                    if (time) time.innerHTML = '<span style="color:#E50914;">Falhou — tenta de novo</span>';
                }
            }
        } catch (_) {
            const placeholder = chatBody.querySelector(`.chat-message.user[data-optimistic="${optId}"]`);
            if (placeholder) {
                const time = placeholder.querySelector('.chat-time');
                if (time) time.innerHTML = '<span style="color:#E50914;">Falhou — tenta de novo</span>';
            }
        } finally {
            isSending = false;
            chatSendBtn.disabled = false;
            // Force a quick refresh
            fetchAndRenderMessages();
        }
    }
}

/* ============================================
   ADMIN SECRET ACCESS — Phase 1 (Logo Hold)
   ============================================ */
function initAdminSecretAccess() {
    const logo = document.getElementById('logoContainer');
    if (!logo) return;

    let _holdT = null;

    const _msg = document.createElement('div');
    _msg.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%) translateY(-10px);
        background: #E50914; color: #fff; font-family: 'Hanken Grotesk', sans-serif;
        font-size: 0.85rem; font-weight: 600; letter-spacing: 0.05em;
        padding: 10px 22px; border-radius: 10px; z-index: 99999;
        opacity: 0; pointer-events: none; transition: opacity 0.4s ease, transform 0.4s ease;
        box-shadow: 0 4px 20px rgba(229,9,20,0.5); white-space: nowrap;
    `;
    _msg.textContent = 'Você está no painel de administrador';
    document.body.appendChild(_msg);

    function _show() {
        _msg.style.opacity = '1';
        _msg.style.transform = 'translateX(-50%) translateY(0)';
        setTimeout(() => {
            _msg.style.opacity = '0';
            _msg.style.transform = 'translateX(-50%) translateY(-10px)';
        }, 16000);
    }

    function _start() {
        if (_holdT) return;
        _holdT = setTimeout(() => {
            _holdT = null;
            if (!window.__mzp) {
                window.__mzp = 1;
                _show();
            }
        }, 10000);
    }

    function _cancel() {
        if (_holdT) { clearTimeout(_holdT); _holdT = null; }
    }

    logo.addEventListener('mousedown', _start);
    logo.addEventListener('touchstart', _start, { passive: true });
    logo.addEventListener('mouseup', _cancel);
    logo.addEventListener('mouseleave', _cancel);
    logo.addEventListener('touchend', _cancel);
    logo.addEventListener('touchcancel', _cancel);
    logo.style.userSelect = 'none';
    logo.style.webkitUserSelect = 'none';
}
