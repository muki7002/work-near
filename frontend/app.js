// ==============================================================================
// WORKNEAR — MASTER CLIENT APPLICATION LOGIC
// Supports: Persistent Database Authentication, User Data Synchronization,
// Real Dynamic Profile, Real Application History & Worker Status Persistence
// ==============================================================================

const getApiBaseUrl = () => {
  if (window.WORKNEAR_CONFIG && window.WORKNEAR_CONFIG.API_URL && window.WORKNEAR_CONFIG.API_URL.trim() !== '') {
    return window.WORKNEAR_CONFIG.API_URL.replace(/\/+$/, '');
  }
  return 'https://work-near.onrender.com';
};

const API_BASE = getApiBaseUrl();

// ------------------------------------------------------------------------------
// APPLICATION STATE
// ------------------------------------------------------------------------------
const state = {
  currentRole: 'worker', // 'worker' | 'employer'
  activeScreen: 'screenSplash',
  screenHistory: ['screenSplash'],
  isLoggedIn: false,
  authToken: null,
  dutyOn: true,
  currentRadius: 22,
  userCoords: { lat: 13.0827, lon: 80.2707 }, // Default: Chennai Central
  activeTimerInterval: null,
  timerSeconds: 6138,
  selectedJobId: null,
  onboardIndex: 0,
  currentUser: null,
  nearbyJobs: [],
  myApplications: [],
  walletBalance: 0,
  currentEmployerTab: 'jobs',
  employerJobsList: [],
  selectedVerification: null
};

const $ = id => document.getElementById(id);

// ------------------------------------------------------------------------------
// INITIALIZATION
// ------------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  detectLiveLocation();

  // Check URL query parameters for initial role (?role=worker|employer|admin)
  const urlParams = new URLSearchParams(window.location.search);
  const roleParam = urlParams.get('role');
  if (roleParam === 'admin') {
    window.location.href = 'admin.html';
    return;
  }
  if (roleParam === 'employer' || roleParam === 'worker') {
    state.currentRole = roleParam;
  }

  // Restore saved persistent session
  await restoreSavedSession();

  // Synchronize top pills and auth forms
  if ($('pillWorker')) $('pillWorker').classList.toggle('active', state.currentRole === 'worker');
  if ($('pillEmployer')) $('pillEmployer').classList.toggle('active', state.currentRole === 'employer');
  if ($('pillAdmin')) $('pillAdmin').classList.toggle('active', false);
  setLoginRole(state.currentRole);
  setRegRole(state.currentRole);

  // Load jobs and data
  await loadNearbyJobsFromBackend();
  if (state.isLoggedIn && state.currentUser) {
    await loadWorkerApplications();
    await loadWorkerWallet();
  }
});

// ------------------------------------------------------------------------------
// SESSION RESTORATION & PROFILE FETCH
// ------------------------------------------------------------------------------
async function restoreSavedSession() {
  try {
    const savedToken = localStorage.getItem('worknear_auth_token');
    const savedUserJson = localStorage.getItem('worknear_auth_user');

    if (savedToken && savedUserJson) {
      const parsedUser = JSON.parse(savedUserJson);
      state.authToken = savedToken;
      state.currentUser = parsedUser;
      state.isLoggedIn = true;
      state.currentRole = parsedUser.role || 'worker';
      state.dutyOn = parsedUser.work_on !== false;

      // Update role buttons
      if ($('pillWorker')) $('pillWorker').classList.toggle('active', state.currentRole === 'worker');
      if ($('pillEmployer')) $('pillEmployer').classList.toggle('active', state.currentRole === 'employer');
      if ($('pillAdmin')) $('pillAdmin').classList.toggle('active', false);
      setLoginRole(state.currentRole);
      setRegRole(state.currentRole);

      // Fetch fresh profile from backend to ensure data is in sync with database
      try {
        const res = await fetch(`${API_BASE}/users/${parsedUser.id}`);
        if (res.ok) {
          const freshUser = await res.json();
          state.currentUser = freshUser;
          state.dutyOn = freshUser.work_on !== false;
          localStorage.setItem('worknear_auth_user', JSON.stringify(freshUser));
        }
      } catch (err) {
        console.log("Backend offline or using cached session", err);
      }

      renderUserProfile();
    } else {
      state.isLoggedIn = false;
      state.currentUser = null;
      state.authToken = null;
    }
  } catch (e) {
    console.error("Session restore error", e);
    state.isLoggedIn = false;
  }
}

// ------------------------------------------------------------------------------
// NAVIGATION ROUTER WITH AUTH GUARD
// ------------------------------------------------------------------------------
function navigateTo(screenId) {
  const publicScreens = ['screenSplash', 'screenOnboarding', 'screenLogin', 'screenRegister'];

  // Auth Guard: Enforce login/registration before accessing inner screens
  if (!state.isLoggedIn && !publicScreens.includes(screenId)) {
    showToast("🔒 Please login or register first to open the app", "🔑", 3000);
    screenId = 'screenLogin';
  }

  const current = document.querySelector('.screen-view.active');
  if (current) current.classList.remove('active');

  const target = $(screenId);
  if (target) {
    target.classList.add('active');
    state.activeScreen = screenId;
    state.screenHistory.push(screenId);
  }

  // Update Top Nav Visibility
  const topNav = $('topNavBar');
  const bottomNav = $('mainBottomNav');

  if (['screenSplash', 'screenOnboarding', 'screenLogin', 'screenRegister'].includes(screenId) || !state.isLoggedIn) {
    if (topNav) topNav.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';
  } else {
    if (topNav) topNav.style.display = 'flex';
    if (bottomNav) bottomNav.style.display = state.currentRole === 'worker' ? 'flex' : 'none';
  }

  // Update Bottom Nav active states
  ['navHome', 'navJobs', 'navEarnings', 'navHistory', 'navProfile'].forEach(id => {
    if ($(id)) $(id).classList.remove('active');
  });

  if (screenId === 'screenWorkerHome' && $('navHome')) $('navHome').classList.add('active');
  if (screenId === 'screenNearbyJobs' && $('navJobs')) $('navJobs').classList.add('active');
  if (screenId === 'screenEarnings' && $('navEarnings')) $('navEarnings').classList.add('active');
  if (screenId === 'screenJobHistory' && $('navHistory')) $('navHistory').classList.add('active');
  if (screenId === 'screenProfile' && $('navProfile')) $('navProfile').classList.add('active');

  if (screenId === 'screenProfile' || screenId === 'screenWorkerHome') {
    renderUserProfile();
  }
  if (screenId === 'screenJobHistory') {
    loadWorkerApplications();
  }
  if (screenId === 'screenEarnings') {
    loadWorkerWallet();
  }
  if (screenId === 'screenEmployerHome') {
    renderEmployerJobs();
  }

  const viewport = document.querySelector('.screens-viewport');
  if (viewport) viewport.scrollTop = 0;
}

function navigateBack() {
  if (state.screenHistory.length > 1) {
    state.screenHistory.pop();
    const prev = state.screenHistory.pop();
    navigateTo(prev);
  } else {
    if (!state.isLoggedIn) {
      navigateTo('screenLogin');
    } else {
      navigateTo(state.currentRole === 'worker' ? 'screenWorkerHome' : 'screenEmployerHome');
    }
  }
}

// ------------------------------------------------------------------------------
// ROLE SWITCHER
// ------------------------------------------------------------------------------
function switchAppRole(role) {
  if (role === 'admin') {
    window.location.href = 'admin.html';
    return;
  }

  state.currentRole = role;
  if ($('pillWorker')) $('pillWorker').classList.toggle('active', role === 'worker');
  if ($('pillEmployer')) $('pillEmployer').classList.toggle('active', role === 'employer');
  if ($('pillAdmin')) $('pillAdmin').classList.toggle('active', false);

  // Synchronize role badges and fields in login and register screens
  setLoginRole(role);
  setRegRole(role);

  if (!state.isLoggedIn) {
    if (state.activeScreen === 'screenRegister') {
      showToast(`Selected ${role === 'worker' ? 'Worker' : 'Employer'} Registration`, role === 'worker' ? '👨‍🎓' : '🏪');
    } else if (state.activeScreen === 'screenLogin') {
      showToast(`Selected ${role === 'worker' ? 'Worker' : 'Employer'} Login`, role === 'worker' ? '👨‍🎓' : '🏪');
    } else {
      showToast(`Switched mode to ${role === 'worker' ? 'Worker' : 'Employer'}`, role === 'worker' ? '👨‍🎓' : '🏪');
    }
    return;
  }

  if (role === 'worker') {
    navigateTo('screenWorkerHome');
    showToast("Switched to Worker App", "👨‍🎓");
  } else {
    navigateTo('screenEmployerHome');
    showToast("Switched to Employer App", "🏪");
  }
}

function setLoginRole(role) {
  state.currentRole = role;
  if ($('pillWorker')) $('pillWorker').classList.toggle('active', role === 'worker');
  if ($('pillEmployer')) $('pillEmployer').classList.toggle('active', role === 'employer');
  if ($('pillAdmin')) $('pillAdmin').classList.toggle('active', false);

  if ($('loginRoleBadge')) {
    $('loginRoleBadge').textContent = role === 'worker' ? '👨‍🎓 Worker' : '🏪 Employer';
    $('loginRoleBadge').className = role === 'worker' ? 'badge badge-approved' : 'badge badge-pending';
  }
}

function setRegRole(role) {
  state.currentRole = role;
  if ($('pillWorker')) $('pillWorker').classList.toggle('active', role === 'worker');
  if ($('pillEmployer')) $('pillEmployer').classList.toggle('active', role === 'employer');
  if ($('pillAdmin')) $('pillAdmin').classList.toggle('active', false);

  const isWorker = role === 'worker';
  if ($('regCategoryGroup')) $('regCategoryGroup').style.display = isWorker ? 'block' : 'none';
  if ($('regHoursGroup')) $('regHoursGroup').style.display = isWorker ? 'block' : 'none';
  if ($('regSkillsGroup')) $('regSkillsGroup').style.display = isWorker ? 'block' : 'none';

  if ($('regRoleBadge')) {
    $('regRoleBadge').textContent = isWorker ? '👨‍🎓 Worker' : '🏪 Employer';
    $('regRoleBadge').className = isWorker ? 'badge badge-approved' : 'badge badge-pending';
  }
  if ($('regSubmitBtn')) {
    $('regSubmitBtn').textContent = isWorker ? 'Create Worker Account & Open App →' : 'Create Employer Account & Open App →';
  }
}

// ------------------------------------------------------------------------------
// THEME MANAGEMENT
// ------------------------------------------------------------------------------
function initTheme() {
  const saved = localStorage.getItem('worknear_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  if ($('profileDarkModeToggle')) {
    $('profileDarkModeToggle').checked = (saved === 'dark');
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('worknear_theme', next);
  if ($('profileDarkModeToggle')) {
    $('profileDarkModeToggle').checked = (next === 'dark');
  }
  showToast(`Theme switched to ${next.toUpperCase()} mode`);
}

// ------------------------------------------------------------------------------
// TOAST NOTIFICATION
// ------------------------------------------------------------------------------
function showToast(msg, icon = '✨', duration = 3200) {
  const toast = $('appToast');
  if (!toast) return;
  if ($('toastIcon')) $('toastIcon').textContent = icon;
  if ($('toastMessage')) $('toastMessage').textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), duration);
}

// ------------------------------------------------------------------------------
// ONBOARDING SLIDES
// ------------------------------------------------------------------------------
const onboardingData = [
  {
    graphic: '📍',
    title: 'Find Nearby Jobs',
    desc: 'Discover verified micro-jobs within your selected 22 KM radius in real time.'
  },
  {
    graphic: '⏳',
    title: 'Work in Your Free Time',
    desc: 'Select shifts that fit your schedule — from 1 to 4 hours in evenings and weekends.'
  },
  {
    graphic: '💰',
    title: 'Earn from Completed Tasks',
    desc: 'Upload photo proof upon completion and receive direct payouts for your work.'
  }
];

function nextOnboardingSlide() {
  state.onboardIndex++;
  if (state.onboardIndex >= onboardingData.length) {
    navigateTo('screenLogin');
    state.onboardIndex = 0;
    return;
  }

  const data = onboardingData[state.onboardIndex];
  if ($('onboardGraphic')) $('onboardGraphic').textContent = data.graphic;
  if ($('onboardTitle')) $('onboardTitle').textContent = data.title;
  if ($('onboardDesc')) $('onboardDesc').textContent = data.desc;

  [0, 1, 2].forEach(i => {
    if ($(`dot${i}`)) $(`dot${i}`).classList.toggle('active', i === state.onboardIndex);
  });

  if (state.onboardIndex === onboardingData.length - 1) {
    if ($('onboardNextBtn')) $('onboardNextBtn').textContent = 'Get Started 🚀';
  }
}

// ------------------------------------------------------------------------------
// ------------------------------------------------------------------------------
// AUTHENTICATION: OTP HELPERS & REGISTRATION (DATABASE BACKEND)
// ------------------------------------------------------------------------------
async function requestLoginOtp() {
  const phone = $('loginPhoneInput') ? $('loginPhoneInput').value.trim() : '';
  if (!phone || phone.length < 10) {
    alert("Please enter a valid 10-digit mobile number!");
    return;
  }

  try {
    showToast("Sending verification OTP...", "⏳");
    const res = await fetch(`${API_BASE}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    const otp = data.otp || `${Math.floor(1000 + Math.random() * 9000)}`;

    if ($('loginOtpGroup')) $('loginOtpGroup').style.display = 'block';
    if ($('loginOtpInput')) {
      $('loginOtpInput').value = otp;
      $('loginOtpInput').focus();
    }
    if ($('loginOtpHint')) $('loginOtpHint').textContent = `OTP: ${otp}`;
    if ($('loginSendOtpBtn')) $('loginSendOtpBtn').textContent = 'Resend OTP';

    showToast(`OTP sent to +91 ${phone}! (Code: ${otp})`, "📱", 4000);
  } catch (err) {
    console.warn("Backend offline, generating local random OTP", err);
    const randomOtp = `${Math.floor(1000 + Math.random() * 9000)}`;
    if ($('loginOtpGroup')) $('loginOtpGroup').style.display = 'block';
    if ($('loginOtpInput')) $('loginOtpInput').value = randomOtp;
    if ($('loginOtpHint')) $('loginOtpHint').textContent = `OTP: ${randomOtp}`;
    showToast(`OTP sent to +91 ${phone}! (Code: ${randomOtp})`, "📱", 4000);
  }
}

async function verifyAndLogin() {
  const phone = $('loginPhoneInput') ? $('loginPhoneInput').value.trim() : '';
  if (!phone || phone.length < 10) {
    alert("Please enter your registered 10-digit mobile number!");
    return;
  }

  // If OTP input group isn't visible yet, request OTP first
  const otpGroup = $('loginOtpGroup');
  if (otpGroup && otpGroup.style.display === 'none') {
    await requestLoginOtp();
    return;
  }

  const otp = $('loginOtpInput') ? $('loginOtpInput').value.trim() : '';
  if (!otp) {
    alert("Please enter the 4-digit OTP sent to your phone!");
    return;
  }

  try {
    showToast("Verifying OTP & logging in...", "⏳");
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.detail || "Login failed. Please verify your OTP or register first.");
      return;
    }

    // Save session in localStorage
    state.isLoggedIn = true;
    state.authToken = data.token;
    state.currentUser = data.user;
    state.currentRole = data.user.role || state.currentRole || 'worker';
    state.dutyOn = data.user.work_on !== false;

    // Update role buttons
    if ($('pillWorker')) $('pillWorker').classList.toggle('active', state.currentRole === 'worker');
    if ($('pillEmployer')) $('pillEmployer').classList.toggle('active', state.currentRole === 'employer');
    if ($('pillAdmin')) $('pillAdmin').classList.toggle('active', false);
    setLoginRole(state.currentRole);
    setRegRole(state.currentRole);

    localStorage.setItem('worknear_auth_token', data.token);
    localStorage.setItem('worknear_auth_user', JSON.stringify(data.user));

    renderUserProfile();
    await loadWorkerApplications();
    await loadWorkerWallet();

    if (state.currentRole === 'worker') {
      navigateTo('screenWorkerHome');
    } else {
      navigateTo('screenEmployerHome');
    }

    showToast(`Welcome back, ${data.user.name}!`, "👋", 3000);
  } catch (err) {
    console.error("Login Error", err);
    alert("Unable to connect to backend server. Make sure the server is running on port 8000.");
  }
}

async function sendOtpLogin() {
  await verifyAndLogin();
}

async function requestRegisterOtp() {
  const phone = $('regPhone') ? $('regPhone').value.trim() : '';
  if (!phone || phone.length < 10) {
    alert("Please enter a valid 10-digit mobile number!");
    return;
  }

  try {
    showToast("Sending registration OTP...", "⏳");
    const res = await fetch(`${API_BASE}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    const otp = data.otp || `${Math.floor(1000 + Math.random() * 9000)}`;

    if ($('regOtpGroup')) $('regOtpGroup').style.display = 'block';
    if ($('regOtpInput')) {
      $('regOtpInput').value = otp;
      $('regOtpInput').focus();
    }
    if ($('regOtpHint')) $('regOtpHint').textContent = `OTP: ${otp}`;
    if ($('regSendOtpBtn')) $('regSendOtpBtn').textContent = 'Resend OTP';

    showToast(`OTP sent to +91 ${phone}! (Code: ${otp})`, "📱", 4000);
  } catch (err) {
    console.warn("Backend offline, generating local random OTP", err);
    const randomOtp = `${Math.floor(1000 + Math.random() * 9000)}`;
    if ($('regOtpGroup')) $('regOtpGroup').style.display = 'block';
    if ($('regOtpInput')) $('regOtpInput').value = randomOtp;
    if ($('regOtpHint')) $('regOtpHint').textContent = `OTP: ${randomOtp}`;
    showToast(`OTP sent to +91 ${phone}! (Code: ${randomOtp})`, "📱", 4000);
  }
}

async function submitWorkerRegistration() {
  const name = $('regFullName') ? $('regFullName').value.trim() : '';
  const phone = $('regPhone') ? $('regPhone').value.trim() : '';
  const dob = $('regDob') ? $('regDob').value : '';
  const email = $('regEmail') ? $('regEmail').value.trim() : '';
  const categorySelect = $('regCategory');
  const category = categorySelect ? categorySelect.value : 'Retail & Supermarket Helper';
  const hours = $('regHours') ? $('regHours').value.trim() : '';
  const rawSkills = $('regSkills') ? $('regSkills').value.trim() : '';

  if (!name) {
    alert("Please enter your Full Name!");
    return;
  }
  if (!phone || phone.length < 10) {
    alert("Please enter a valid 10-digit Mobile Number!");
    return;
  }

  // If OTP group isn't shown yet, prompt OTP
  const otpGroup = $('regOtpGroup');
  if (otpGroup && otpGroup.style.display === 'none') {
    await requestRegisterOtp();
    return;
  }

  const otp = $('regOtpInput') ? $('regOtpInput').value.trim() : '';
  if (!otp) {
    alert("Please enter the 4-digit OTP sent to your phone!");
    return;
  }

  const skillsList = rawSkills
    ? rawSkills.split(',').map(s => s.trim()).filter(Boolean)
    : ['General Shift Assistant'];

  const payload = {
    name,
    phone,
    email: email || null,
    otp,
    role: state.currentRole || 'worker',
    dob: dob || null,
    category: state.currentRole === 'worker' ? category : null,
    hours: state.currentRole === 'worker' ? (hours || 'Flexible Hours') : null,
    skills: skillsList,
    lat: state.userCoords.lat,
    lon: state.userCoords.lon
  };

  try {
    showToast("Verifying OTP & creating account...", "⏳");
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.detail || "Registration failed. Please check your OTP and details.");
      return;
    }

    // Save session in localStorage
    state.isLoggedIn = true;
    state.authToken = data.token;
    state.currentUser = data.user;
    state.dutyOn = data.user.work_on !== false;

    // Update role buttons
    if ($('pillWorker')) $('pillWorker').classList.toggle('active', state.currentRole === 'worker');
    if ($('pillEmployer')) $('pillEmployer').classList.toggle('active', state.currentRole === 'employer');
    if ($('pillAdmin')) $('pillAdmin').classList.toggle('active', false);
    setLoginRole(state.currentRole);
    setRegRole(state.currentRole);

    localStorage.setItem('worknear_auth_token', data.token);
    localStorage.setItem('worknear_auth_user', JSON.stringify(data.user));

    renderUserProfile();
    await loadWorkerApplications();
    await loadWorkerWallet();

    if (state.currentRole === 'worker') {
      navigateTo('screenWorkerHome');
    } else {
      navigateTo('screenEmployerHome');
    }

    showToast(`Account Created! Welcome, ${data.user.name}!`, "🎉", 3500);
  } catch (err) {
    console.error("Registration Error", err);
    alert("Unable to connect to backend server. Make sure server is running.");
  }
}

async function quickLoginDemo(role) {
  const targetRole = role || state.currentRole || 'worker';
  const defaultPhone = targetRole === 'employer' ? '9876543210' : '9123456780';

  if ($('loginPhoneInput')) $('loginPhoneInput').value = defaultPhone;
  await requestLoginOtp();
  await verifyAndLogin();
}

// ------------------------------------------------------------------------------
// LOGOUT (CLEARS SESSION AND LOCKS THE APP)
// ------------------------------------------------------------------------------
function logoutWorker() {
  state.isLoggedIn = false;
  state.currentUser = null;
  state.authToken = null;
  state.myApplications = [];
  state.walletBalance = 0;

  localStorage.removeItem('worknear_auth_token');
  localStorage.removeItem('worknear_auth_user');

  if ($('loginPhoneInput')) $('loginPhoneInput').value = '';
  if ($('loginOtpInput')) $('loginOtpInput').value = '';
  if ($('loginOtpGroup')) $('loginOtpGroup').style.display = 'none';
  if ($('regPhone')) $('regPhone').value = '';
  if ($('regOtpInput')) $('regOtpInput').value = '';
  if ($('regOtpGroup')) $('regOtpGroup').style.display = 'none';

  navigateTo('screenLogin');
  showToast("Logged out successfully. App locked.", "🔒", 3000);
}

// ------------------------------------------------------------------------------
// USER PROFILE: RENDERING & EDITING (DATABASE SYNC)
// ------------------------------------------------------------------------------
function renderUserProfile() {
  const u = state.currentUser;
  if (!u) return;

  // Home Screen Greeting
  if ($('homeWorkerName')) {
    $('homeWorkerName').textContent = u.name || 'Worker';
  }

  // Profile Screen
  if ($('profileUserName')) {
    $('profileUserName').textContent = u.name || 'User Name';
  }
  if ($('profileUserSub')) {
    $('profileUserSub').textContent = `${u.category || 'Worker'} • Verified Member ✓`;
  }
  if ($('profileUserPhone')) {
    $('profileUserPhone').textContent = u.phone || '-';
  }
  if ($('profileUserEmail')) {
    $('profileUserEmail').textContent = u.email || 'Not Provided';
  }
  if ($('profileUserDob')) {
    $('profileUserDob').textContent = u.dob || 'Not Provided';
  }
  if ($('profileUserCategory')) {
    $('profileUserCategory').textContent = u.category || 'Retail & Supermarket Helper';
  }
  if ($('profileUserHours')) {
    $('profileUserHours').textContent = u.hours || 'Flexible Hours';
  }
  if ($('profileUserId')) {
    $('profileUserId').textContent = u.id || '-';
  }
  if ($('profileRoleBadge')) {
    $('profileRoleBadge').textContent = (u.role || 'worker').toUpperCase();
  }

  // Skills
  if ($('profileUserSkillsContainer')) {
    const container = $('profileUserSkillsContainer');
    let skillsList = u.skills;
    if (typeof skillsList === 'string') {
      try {
        skillsList = JSON.parse(skillsList);
      } catch (e) {
        skillsList = skillsList.split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    if (Array.isArray(skillsList) && skillsList.length > 0) {
      container.innerHTML = skillsList.map(skill => `<span class="job-tag">✨ ${escapeHtml(skill)}</span>`).join('');
    } else {
      container.innerHTML = `<span class="job-tag">✨ General Worker</span>`;
    }
  }

  // Populate Edit Profile Inputs
  if ($('editProfileName')) $('editProfileName').value = u.name || '';
  if ($('editProfileEmail')) $('editProfileEmail').value = u.email || '';
  if ($('editProfileDob')) $('editProfileDob').value = u.dob || '';
  if ($('editProfileCategory')) $('editProfileCategory').value = u.category || '';
  if ($('editProfileHours')) $('editProfileHours').value = u.hours || '';
  if ($('editProfileSkills')) {
    const s = Array.isArray(u.skills) ? u.skills.join(', ') : (u.skills || '');
    $('editProfileSkills').value = s;
  }

  // Sync Duty Switch
  if ($('mainDutySwitch')) {
    $('mainDutySwitch').checked = state.dutyOn;
  }
  if ($('heroAvailabilityCard')) {
    $('heroAvailabilityCard').classList.toggle('on', state.dutyOn);
  }
  if ($('availTitleText')) {
    $('availTitleText').textContent = state.dutyOn ? 'WORK ON 🟢' : 'WORK OFF ⚫';
  }
  if ($('availSubtitleText')) {
    $('availSubtitleText').textContent = state.dutyOn ? "You're available for nearby jobs" : "Turn ON to discover jobs";
  }
}

function toggleEditProfileForm() {
  const card = $('editProfileCard');
  if (card) {
    card.style.display = card.style.display === 'none' ? 'block' : 'none';
  }
}

async function saveEditedProfile() {
  if (!state.currentUser || !state.currentUser.id) return;

  const name = $('editProfileName').value.trim();
  const email = $('editProfileEmail').value.trim();
  const dob = $('editProfileDob').value;
  const category = $('editProfileCategory').value.trim();
  const hours = $('editProfileHours').value.trim();
  const rawSkills = $('editProfileSkills').value.trim();

  if (!name) {
    alert("Name cannot be empty!");
    return;
  }

  const skillsList = rawSkills
    ? rawSkills.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const updatePayload = {
    name,
    email: email || null,
    dob: dob || null,
    category: category || null,
    hours: hours || null,
    skills: skillsList
  };

  try {
    showToast("Saving changes to database...", "⏳");
    const res = await fetch(`${API_BASE}/users/${state.currentUser.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload)
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.detail || "Failed to update profile.");
      return;
    }

    state.currentUser = data.user;
    localStorage.setItem('worknear_auth_user', JSON.stringify(data.user));
    renderUserProfile();
    toggleEditProfileForm();
    showToast("Profile updated successfully in database!", "✓", 3000);
  } catch (err) {
    console.error("Profile update error", err);
    alert("Failed to connect to backend server.");
  }
}

// ------------------------------------------------------------------------------
// WORKER AVAILABILITY STATUS (PERSISTS IN DATABASE)
// ------------------------------------------------------------------------------
async function handleDutySwitchChange() {
  const isChecked = $('mainDutySwitch').checked;
  state.dutyOn = isChecked;

  const card = $('heroAvailabilityCard');
  if (card) card.classList.toggle('on', isChecked);

  if ($('availTitleText')) {
    $('availTitleText').textContent = isChecked ? 'WORK ON 🟢' : 'WORK OFF ⚫';
  }
  if ($('availSubtitleText')) {
    $('availSubtitleText').textContent = isChecked ? "You're available for nearby jobs" : 'Turn ON to discover jobs';
  }

  showToast(isChecked ? "WORK ON 🟢 Available for jobs" : "WORK OFF ⚫ Marked unavailable");

  // Persist status in backend database
  if (state.currentUser && state.currentUser.id) {
    try {
      await fetch(`${API_BASE}/workers/${state.currentUser.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ work_on: isChecked })
      });
      state.currentUser.work_on = isChecked;
      localStorage.setItem('worknear_auth_user', JSON.stringify(state.currentUser));
    } catch (e) {
      console.log("Failed to sync worker status to backend", e);
    }
  }

  renderHomeJobs();
}

// ------------------------------------------------------------------------------
// NEARBY JOBS BACKEND SYNC & RENDERING
// ------------------------------------------------------------------------------
async function loadNearbyJobsFromBackend() {
  try {
    const lat = state.userCoords.lat || 13.0827;
    const lon = state.userCoords.lon || 80.2707;
    const res = await fetch(`${API_BASE}/jobs?lat=${lat}&lon=${lon}&radius_km=${state.currentRadius}`);
    if (res.ok) {
      const data = await res.json();
      state.nearbyJobs = data;
    }
  } catch (e) {
    console.log("Using local job catalog", e);
  }

  renderHomeJobs();
  renderAllNearbyJobs();
}

function renderHomeJobs() {
  const container = $('homeJobsContainer');
  if (!container) return;

  if (!state.dutyOn) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🌙</span>
        <div class="empty-title">You are currently OFF Duty</div>
        <p class="empty-desc">Turn your availability switch ON above to receive nearby job alerts.</p>
      </div>
    `;
    return;
  }

  const jobs = state.nearbyJobs && state.nearbyJobs.length > 0 ? state.nearbyJobs : [];
  if (jobs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📍</span>
        <div class="empty-title">No jobs within ${state.currentRadius} KM</div>
        <p class="empty-desc">Try increasing your matching radius or checking back soon.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = jobs.slice(0, 4).map(j => createJobCardHtml(j)).join('');
}

function renderAllNearbyJobs() {
  const container = $('allNearbyJobsContainer');
  if (!container) return;

  const jobs = state.nearbyJobs && state.nearbyJobs.length > 0 ? state.nearbyJobs : [];
  if (jobs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        <div class="empty-title">No jobs available within ${state.currentRadius} KM</div>
        <p class="empty-desc">Adjust the radius chips above to expand your search.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = jobs.map(j => createJobCardHtml(j)).join('');
}

function createJobCardHtml(j) {
  const dist = j.distance_km || j.distance || 1.2;
  const pay = j.payment || j.pay || 450;
  const dur = j.duration_hours || j.duration || 2;
  const business = j.employer_name || j.business || 'Verified Employer';
  const category = j.category || 'General';

  return `
    <div class="job-card" onclick="openJobDetails('${j.id}')">
      <div class="job-top-row">
        <div class="job-title-group">
          <h4>${escapeHtml(j.title)}</h4>
          <div class="job-business-name">🏢 ${escapeHtml(business)}</div>
        </div>
        <div class="price-pill">₹${pay}</div>
      </div>
      <p class="job-desc" style="font-size:12px;color:var(--text-secondary);">${escapeHtml(j.description || j.desc || '')}</p>
      <div class="job-tags-row">
        <span class="job-tag distance-badge">📍 ${dist} KM away</span>
        <span class="job-tag">⏱ ${dur} Hours</span>
        <span class="job-tag">${escapeHtml(category)}</span>
      </div>
      <div class="job-footer-row">
        <span style="font-size:11px;color:var(--text-tertiary);">Radius: ${state.currentRadius} KM match</span>
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); openJobDetails('${j.id}')">
          View & Apply →
        </button>
      </div>
    </div>
  `;
}

function filterJobsBySearch() {
  const query = $('jobSearchInput') ? $('jobSearchInput').value.toLowerCase() : '';
  const filtered = state.nearbyJobs.filter(j =>
    (j.title.toLowerCase().includes(query) || (j.category && j.category.toLowerCase().includes(query)) || (j.description && j.description.toLowerCase().includes(query)))
  );

  const container = $('allNearbyJobsContainer');
  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🔍</span>
        <div class="empty-title">No matching jobs found</div>
        <p class="empty-desc">Try searching for other keywords.</p>
      </div>
    `;
    return;
  }
  container.innerHTML = filtered.map(j => createJobCardHtml(j)).join('');
}

function setRadiusFilter(km, btnElement) {
  state.currentRadius = km;
  document.querySelectorAll('.radius-chip').forEach(c => {
    c.classList.toggle('active', c.textContent.includes(`${km} KM`));
  });
  if ($('currentRadiusLabel')) {
    $('currentRadiusLabel').textContent = `${km} KM Radius`;
  }
  showToast(`Filtered jobs within ${km} KM radius`, "📍");
  loadNearbyJobsFromBackend();
}

function toggleMapListView() {
  const map = $('jobsMapView');
  const btn = $('viewToggleBtn');
  if (map.style.display === 'none') {
    map.style.display = 'flex';
    btn.textContent = '📋 List';
  } else {
    map.style.display = 'none';
    btn.textContent = '🗺️ Map';
  }
}

// ------------------------------------------------------------------------------
// JOB DETAILS & REAL APPLICATION WORKFLOW
// ------------------------------------------------------------------------------
function openJobDetails(jobId) {
  state.selectedJobId = jobId;
  const j = state.nearbyJobs.find(item => item.id === jobId) || {
    id: jobId,
    title: 'Nearby Micro Job',
    description: 'General task assistance on site.',
    payment: 450,
    duration_hours: 3,
    address: 'Work Site Location',
    distance_km: 1.5,
    employer_name: 'Verified Business'
  };

  const pay = j.payment || j.pay || 450;
  const dur = j.duration_hours || j.duration || 2;
  const dist = j.distance_km || j.distance || 1.2;

  if ($('detailJobTitle')) $('detailJobTitle').textContent = j.title;
  if ($('detailBusinessName')) $('detailBusinessName').textContent = `🏢 ${j.employer_name || j.business || 'Verified Business'}`;
  if ($('detailPayBadge')) $('detailPayBadge').textContent = `₹${pay}`;
  if ($('detailDistance')) $('detailDistance').textContent = `📍 ${dist} KM away`;
  if ($('detailDuration')) $('detailDuration').textContent = `⏱ ${dur} Hours`;
  if ($('detailDesc')) $('detailDesc').textContent = j.description || j.desc || 'General on-site tasks';
  if ($('detailAddress')) $('detailAddress').textContent = j.address || 'Chennai Central';
  if ($('applyDetailBtn')) $('applyDetailBtn').textContent = `Apply for Job (₹${pay})`;

  navigateTo('screenJobDetails');
}

async function applyCurrentJob() {
  if (!state.isLoggedIn || !state.currentUser) {
    showToast("Please login first to apply for jobs", "🔒");
    navigateTo('screenLogin');
    return;
  }

  const j = state.nearbyJobs.find(item => item.id === state.selectedJobId) || {
    id: state.selectedJobId || 'job-101',
    title: 'Supermarket Helper',
    payment: 450,
    address: 'Work Site'
  };

  const pay = j.payment || j.pay || 450;
  const addr = j.address || 'Work Site Location';

  if ($('acceptedJobTitle')) $('acceptedJobTitle').textContent = j.title;
  if ($('acceptedPay')) $('acceptedPay').textContent = `₹${pay}`;
  if ($('acceptedAddress')) $('acceptedAddress').textContent = `📌 ${addr}`;

  try {
    const res = await fetch(`${API_BASE}/jobs/${j.id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: state.currentUser.id })
    });
    if (res.ok) {
      await loadWorkerApplications();
    }
  } catch (e) {
    console.log("Applied locally / backend sync", e);
  }

  navigateTo('screenJobAccepted');
  showToast("Application submitted successfully!", "🎉");
}

function openInGoogleMaps() {
  const j = state.nearbyJobs.find(item => item.id === state.selectedJobId);
  const addr = j ? j.address : "Chennai";
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr + " Chennai")}`, '_blank');
}

// ------------------------------------------------------------------------------
// ACTIVE JOB TRACKER & LIVE TIMER
// ------------------------------------------------------------------------------
function startActiveJobTracker() {
  navigateTo('screenActiveJob');
  showToast("Job shift started! Timer activated.", "⏱️");

  if (state.activeTimerInterval) clearInterval(state.activeTimerInterval);

  state.activeTimerInterval = setInterval(() => {
    state.timerSeconds++;
    const hrs = String(Math.floor(state.timerSeconds / 3600)).padStart(2, '0');
    const mins = String(Math.floor((state.timerSeconds % 3600) / 60)).padStart(2, '0');
    const secs = String(state.timerSeconds % 60).padStart(2, '0');
    if ($('activeJobTimerDigits')) {
      $('activeJobTimerDigits').textContent = `${hrs}:${mins}:${secs}`;
    }
  }, 1000);
}

function handleProofImageSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const grid = $('proofPreviewGrid');
    if (grid) {
      const card = document.createElement('div');
      card.className = 'photo-preview-card';
      card.innerHTML = `
        <img src="${e.target.result}" alt="Uploaded Proof">
        <div class="photo-badge-gps">📍 Live GPS Captured</div>
      `;
      grid.prepend(card);
    }
    showToast("Photo captured with GPS metadata!", "📷");
  };
  reader.readAsDataURL(file);
}

async function submitWorkProof() {
  if (state.activeTimerInterval) clearInterval(state.activeTimerInterval);

  // If connected, upload to API
  const fileInput = $('proofFileInput');
  if (fileInput && fileInput.files && fileInput.files[0] && state.selectedJobId && state.currentUser) {
    const formData = new FormData();
    formData.append('worker_id', state.currentUser.id);
    formData.append('file', fileInput.files[0]);

    try {
      await fetch(`${API_BASE}/jobs/${state.selectedJobId}/proof`, {
        method: 'POST',
        body: formData
      });
    } catch (e) {
      console.log("Proof upload sync", e);
    }
  }

  await loadWorkerApplications();
  await loadWorkerWallet();

  navigateTo('screenJobCompleted');
  showToast("Proof uploaded! Employer notified for approval.", "✓");
}

// ------------------------------------------------------------------------------
// JOB HISTORY (FETCHED STRICTLY FOR LOGGED-IN USER)
// ------------------------------------------------------------------------------
async function loadWorkerApplications() {
  if (!state.currentUser || !state.currentUser.id) return;

  try {
    const res = await fetch(`${API_BASE}/workers/${state.currentUser.id}/applications`);
    if (res.ok) {
      state.myApplications = await res.json();
    }
  } catch (e) {
    console.log("Applications load error", e);
  }

  renderHistoryTab('applied');
}

function switchHistoryTab(tab, btn) {
  document.querySelectorAll('#screenJobHistory .tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderHistoryTab(tab);
}

function renderHistoryTab(tab) {
  const container = $('historyListContainer');
  if (!container) return;

  const apps = state.myApplications || [];

  if (tab === 'applied') {
    const appliedApps = apps.filter(a => a.status === 'applied');
    if (appliedApps.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📋</span>
          <div class="empty-title">No active job applications</div>
          <p class="empty-desc">Discover micro-jobs within 22 KM and apply in 1-click.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = appliedApps.map(a => `
      <div class="card" style="padding:14px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <strong>${escapeHtml(a.job_title)}</strong>
          <span class="badge badge-applied">Applied</span>
        </div>
        <p style="font-size:12px;color:var(--text-secondary);">${escapeHtml(a.employer_name || 'Employer')} • Applied ${a.applied_at || 'Recently'}</p>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
          <strong style="color:var(--primary);">₹${a.payment}</strong>
          <button class="btn btn-primary btn-sm" onclick="navigateTo('screenLocationVerify')">Start Job →</button>
        </div>
      </div>
    `).join('');
  } else if (tab === 'active') {
    const activeApps = apps.filter(a => ['started', 'submitted'].includes(a.status));
    if (activeApps.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">⏱️</span>
          <div class="empty-title">No active shifts in progress</div>
          <p class="empty-desc">When you reach a job site, start your shift timer here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = activeApps.map(a => `
      <div class="card" style="padding:14px;border:1.5px solid var(--secondary); margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <strong>${escapeHtml(a.job_title)}</strong>
          <span class="badge badge-started">● ${a.status === 'submitted' ? 'Proof Under Review' : 'Shift in progress'}</span>
        </div>
        <p style="font-size:12px;color:var(--text-secondary);">${escapeHtml(a.job_address || 'Work Site')}</p>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
          <strong style="color:var(--primary);">₹${a.payment}</strong>
          <button class="btn btn-primary btn-sm" onclick="navigateTo('screenActiveJob')">Open Tracker →</button>
        </div>
      </div>
    `).join('');
  } else {
    const completedApps = apps.filter(a => a.status === 'approved');
    if (completedApps.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🎉</span>
          <div class="empty-title">No completed jobs yet</div>
          <p class="empty-desc">Completed and approved tasks will be listed here with earnings.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = completedApps.map(a => `
      <div class="card" style="padding:14px;margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <strong>${escapeHtml(a.job_title)}</strong>
          <span class="badge badge-approved">✓ Paid</span>
        </div>
        <p style="font-size:12px;color:var(--text-secondary);">${escapeHtml(a.employer_name || 'Employer')} • Completed ${a.applied_at || 'Recently'}</p>
        <strong style="color:var(--primary);font-size:14px;">₹${a.payment} Credited</strong>
      </div>
    `).join('');
  }
}

// ------------------------------------------------------------------------------
// WALLET & EARNINGS (LOGGED-IN USER)
// ------------------------------------------------------------------------------
async function loadWorkerWallet() {
  if (!state.currentUser || !state.currentUser.id) return;

  try {
    const res = await fetch(`${API_BASE}/wallet/${state.currentUser.id}`);
    if (res.ok) {
      const data = await res.json();
      state.walletBalance = data.balance || 0;
    }
  } catch (e) {
    console.log("Wallet load error", e);
  }

  // Update DOM
  if ($('statTodayEarnings')) $('statTodayEarnings').textContent = `₹${state.walletBalance}`;
  if ($('statWeekEarnings')) $('statWeekEarnings').textContent = `₹${state.walletBalance}`;
  
  const completedCount = state.myApplications.filter(a => a.status === 'approved').length;
  if ($('statCompletedJobs')) $('statCompletedJobs').textContent = `${completedCount} Jobs`;

  // Render transactions
  const txContainer = $('transactionsList');
  if (txContainer) {
    const completed = state.myApplications.filter(a => a.status === 'approved');
    if (completed.length === 0) {
      txContainer.innerHTML = `
        <div class="card" style="text-align: center; padding: 20px; color: var(--text-secondary);">
          <p style="font-size: 13px;">No earnings transactions yet.</p>
          <small style="color: var(--text-tertiary);">Complete jobs to earn direct payouts.</small>
        </div>
      `;
    } else {
      txContainer.innerHTML = completed.map(c => `
        <div class="card" style="padding: 12px 14px; margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="font-size: 14px;">${escapeHtml(c.job_title)}</strong>
              <p style="font-size: 11px; color: var(--text-tertiary);">${c.applied_at || 'Recently'} • ${escapeHtml(c.employer_name || 'Employer')}</p>
            </div>
            <div style="text-align: right;">
              <span style="color: var(--primary); font-weight: 800; font-size: 15px;">+₹${c.payment}</span>
              <div style="font-size: 10px; color: var(--primary); font-weight: 700;">Directly Paid ✓</div>
            </div>
          </div>
        </div>
      `).join('');
    }
  }
}

// ------------------------------------------------------------------------------
// EMPLOYER FLOW (POST & MANAGE JOBS, REVIEW APPLICANTS & APPROVE PROOF)
// ------------------------------------------------------------------------------

const JOB_TEMPLATES = {
  supermarket: {
    title: "Supermarket Stock & Shelf Helper",
    category: "Retail & Supermarket",
    desc: "Assist in grocery unloading, arranging shelves, stock checking, barcode scanning and customer assistance.",
    duration: 3,
    pay: 450,
    workers: 1,
    radius: 22,
    address: "15 Anna Salai, T. Nagar"
  },
  bakery: {
    title: "Evening Bakery & Cafe Assistant",
    category: "Cafe & Bakery",
    desc: "Packing fresh bakery items, assisting counter orders, tea/coffee service and evening closing cleaning tasks.",
    duration: 4,
    pay: 500,
    workers: 1,
    radius: 22,
    address: "82 Cathedral Road, Gopalapuram"
  },
  delivery: {
    title: "Urgent Local Document & Parcel Delivery",
    category: "Local Delivery & Errands",
    desc: "Pick up document envelope and deliver safely to corporate client site within 10 km.",
    duration: 2,
    pay: 400,
    workers: 1,
    radius: 22,
    address: "44 MG Road, Nungambakkam"
  },
  bookstall: {
    title: "Book Fair Counter & Pamphlet Distribution",
    category: "General Shift Assistant",
    desc: "Distribute exhibition flyers to visitors, assist customers at book counter, and maintain book stacks.",
    duration: 3,
    pay: 350,
    workers: 2,
    radius: 22,
    address: "YMCA Grounds, Royapettah"
  },
  catering: {
    title: "Evening Event Promotion & Catering Assistant",
    category: "Event Promotion & Catering",
    desc: "Support buffet counter serving, dinner table arrangement and welcoming guests during party.",
    duration: 4,
    pay: 600,
    workers: 2,
    radius: 22,
    address: "Green Park Hall, Vadapalani"
  },
  office: {
    title: "Office Document Filing & Data Entry",
    category: "Office Filing & Data Entry",
    desc: "Organize paper invoice files, scan documents and enter daily expense vouchers into spreadsheet.",
    duration: 3,
    pay: 400,
    workers: 1,
    radius: 22,
    address: "Mount Road Commercial Hub"
  }
};

function fillJobTemplate(type) {
  const t = JOB_TEMPLATES[type];
  if (!t) return;
  if ($('newJobTitle')) $('newJobTitle').value = t.title;
  if ($('newJobCategory')) $('newJobCategory').value = t.category;
  if ($('newJobDesc')) $('newJobDesc').value = t.desc;
  if ($('newJobDuration')) $('newJobDuration').value = t.duration;
  if ($('newJobPay')) $('newJobPay').value = t.pay;
  if ($('newJobWorkers')) $('newJobWorkers').value = t.workers;
  if ($('newJobRadius')) $('newJobRadius').value = t.radius;
  if ($('newJobAddress')) $('newJobAddress').value = t.address;
  updateLiveJobPreview();
  showToast(`Loaded ${t.title} template`, '⚡');
}

function updateLiveJobPreview() {
  const title = $('newJobTitle') ? $('newJobTitle').value.trim() || 'Retail Assistant' : 'Retail Assistant';
  const desc = $('newJobDesc') ? $('newJobDesc').value.trim() || 'Specific shift tasks...' : 'Specific shift tasks...';
  const pay = $('newJobPay') ? $('newJobPay').value || '450' : '450';
  const dur = $('newJobDuration') ? $('newJobDuration').value || '3' : '3';
  const cat = $('newJobCategory') ? $('newJobCategory').value || 'Retail & Supermarket' : 'Retail & Supermarket';

  if ($('previewTitle')) $('previewTitle').textContent = title;
  if ($('previewDesc')) $('previewDesc').textContent = desc;
  if ($('previewPay')) $('previewPay').textContent = `₹${pay}`;
  if ($('previewDuration')) $('previewDuration').textContent = `⏱ ${dur} Hours`;
  if ($('previewCategoryTag')) $('previewCategoryTag').textContent = cat;
  if ($('previewBusinessName')) {
    $('previewBusinessName').textContent = `🏢 ${state.currentUser ? state.currentUser.name : 'My Business'}`;
  }
}

function useCurrentLocationForNewJob() {
  if ($('newJobAddress')) {
    $('newJobAddress').value = "T. Nagar Main Road (Current GPS 13.0827, 80.2707)";
  }
  showToast("GPS coordinates tagged to job post!", "📍");
}

async function publishNewJob() {
  if (!state.isLoggedIn || !state.currentUser) {
    showToast("Please login as Employer to post jobs", "🔒");
    navigateTo('screenLogin');
    return;
  }

  const title = $('newJobTitle') ? $('newJobTitle').value.trim() : '';
  const category = $('newJobCategory') ? $('newJobCategory').value : 'Retail & Supermarket';
  const pay = parseFloat($('newJobPay') ? $('newJobPay').value : 450) || 450;
  const dur = parseFloat($('newJobDuration') ? $('newJobDuration').value : 3) || 3;
  const workers = parseInt($('newJobWorkers') ? $('newJobWorkers').value : 1, 10) || 1;
  const radius = parseFloat($('newJobRadius') ? $('newJobRadius').value : 22) || 22;
  const desc = $('newJobDesc') ? $('newJobDesc').value.trim() : 'Micro job in local area';
  const address = $('newJobAddress') ? $('newJobAddress').value.trim() : '';

  if (!title) {
    showToast("Please enter a job title!", "⚠️");
    if ($('newJobTitle')) $('newJobTitle').focus();
    return;
  }
  if (!address) {
    showToast("Please enter a work site landmark address!", "⚠️");
    if ($('newJobAddress')) $('newJobAddress').focus();
    return;
  }

  const payload = {
    employer_id: state.currentUser.id,
    title,
    description: desc,
    address,
    category,
    lat: state.userCoords.lat || 13.0827,
    lon: state.userCoords.lon || 80.2707,
    duration_hours: dur,
    payment: pay,
    workers_needed: workers,
    radius_km: radius
  };

  try {
    showToast("Publishing job to nearby workers...", "⏳");
    const res = await fetch(`${API_BASE}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      // Clear form inputs
      if ($('newJobTitle')) $('newJobTitle').value = '';
      if ($('newJobDesc')) $('newJobDesc').value = '';
      if ($('newJobAddress')) $('newJobAddress').value = '';

      await loadNearbyJobsFromBackend();
      await renderEmployerJobs();
      navigateTo('screenEmployerHome');
      showToast("🚀 Job published! Workers within 22 KM alerted.", "🎉", 4000);
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || "Failed to publish job", "❌");
    }
  } catch (err) {
    console.error("Job post error", err);
    showToast("Failed to connect to backend server.", "❌");
  }
}

function switchEmployerTab(tab) {
  state.currentEmployerTab = tab;
  if ($('tabEmpJobs')) $('tabEmpJobs').classList.toggle('active', tab === 'jobs');
  if ($('tabEmpCandidates')) $('tabEmpCandidates').classList.toggle('active', tab === 'candidates');
  if ($('empListSectionTitle')) {
    $('empListSectionTitle').textContent = tab === 'jobs' ? 'Manage Posted Jobs & Candidates' : 'All Applied Workers & Candidates';
  }
  renderEmployerJobsList();
}

async function renderEmployerJobs() {
  if (!state.currentUser) return;

  if ($('empBusinessName')) {
    $('empBusinessName').textContent = state.currentUser.name || 'My Business';
  }

  try {
    const res = await fetch(`${API_BASE}/employer/${state.currentUser.id}/jobs`);
    if (res.ok) {
      state.employerJobsList = await res.json();
    } else {
      state.employerJobsList = [];
    }
  } catch (e) {
    console.log("Employer jobs fetch error", e);
    state.employerJobsList = [];
  }

  const jobs = state.employerJobsList || [];

  // Update statistics
  const activeJobs = jobs.filter(j => j.status !== 'completed').length;
  if ($('empActiveJobsCount')) $('empActiveJobsCount').textContent = activeJobs;
  if ($('empTabJobsCount')) $('empTabJobsCount').textContent = jobs.length;

  let totalApplicants = 0;
  let totalSpent = 0;
  jobs.forEach(j => {
    const apps = j.applications || [];
    totalApplicants += apps.length;
    apps.forEach(a => {
      if (a.status === 'approved') {
        totalSpent += (j.payment || 0);
      }
    });
  });

  if ($('empApplicantsCount')) $('empApplicantsCount').textContent = totalApplicants;
  if ($('empTabCandidatesCount')) $('empTabCandidatesCount').textContent = totalApplicants;
  if ($('empSpentCount')) $('empSpentCount').textContent = `₹${totalSpent}`;

  renderEmployerJobsList();
}

function renderEmployerJobsList() {
  const container = $('employerJobsContainer');
  if (!container) return;

  const jobs = state.employerJobsList || [];

  if (state.currentEmployerTab === 'jobs') {
    // -------------------------------------------------------------
    // TAB 1: MY POSTED JOBS (WITH NESTED APPLICANTS PER JOB)
    // -------------------------------------------------------------
    if (jobs.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">➕</span>
          <div class="empty-title">No posted jobs yet</div>
          <p class="empty-desc">Tap "Post Job" above to broadcast micro-jobs to nearby workers.</p>
          <button class="btn btn-primary btn-sm" style="margin-top:10px;" onclick="navigateTo('screenCreateJob')">
            ➕ Post Your First Job
          </button>
        </div>
      `;
      return;
    }

    container.innerHTML = jobs.map(j => {
      const apps = j.applications || [];
      const isCompleted = j.status === 'completed';

      const applicantsHtml = apps.length === 0 ? `
        <div class="empty-state" style="padding:14px;background:var(--bg-subtle);border-radius:var(--radius-sm);margin-top:8px;">
          <span style="font-size:18px;">⏳</span>
          <div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin-top:2px;">Awaiting candidate applications</div>
          <p style="font-size:11px;color:var(--text-tertiary);margin:2px 0 0 0;">Workers within ${j.radius_km || 22} KM can discover and apply for this job in real time.</p>
        </div>
      ` : `
        <div class="candidate-list-box">
          <div style="font-size:11px;font-weight:800;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.4px;">
            👥 Applied Workers (${apps.length}):
          </div>
          ${apps.map(a => renderCandidateCard(a, j)).join('')}
        </div>
      `;

      return `
        <div class="job-card" style="border-left: 4px solid ${isCompleted ? 'var(--primary)' : 'var(--secondary)'};">
          <div class="job-top-row">
            <div class="job-title-group">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <h4>${escapeHtml(j.title)}</h4>
                <span class="badge ${isCompleted ? 'badge-approved' : 'badge-started'}">
                  ${isCompleted ? '✓ Completed' : '● Open'}
                </span>
              </div>
              <div class="job-business-name">
                🏷️ ${escapeHtml(j.category || 'General')} • ⏱ ${j.duration_hours || 2}h shift • 📍 ${escapeHtml(j.address || 'Nearby')}
              </div>
            </div>
            <div class="price-pill">₹${j.payment}</div>
          </div>

          <p class="job-desc" style="font-size:12px;color:var(--text-secondary);margin:0;">
            ${escapeHtml(j.description || 'No additional instructions.')}
          </p>

          <div class="job-tags-row">
            <span class="job-tag">👥 ${j.workers_needed || 1} Worker(s) Needed</span>
            <span class="job-tag">📡 Radius: ${j.radius_km || 22} KM</span>
            <span class="job-tag distance-badge">🎯 ${apps.length} Applied</span>
          </div>

          ${applicantsHtml}
        </div>
      `;
    }).join('');

  } else {
    // -------------------------------------------------------------
    // TAB 2: ALL APPLIED CANDIDATES / WORKERS ACROSS ALL JOBS
    // -------------------------------------------------------------
    const allCandidates = [];
    jobs.forEach(j => {
      (j.applications || []).forEach(a => {
        allCandidates.push({ candidate: a, job: j });
      });
    });

    if (allCandidates.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">👥</span>
          <div class="empty-title">No candidates have applied yet</div>
          <p class="empty-desc">When students or workers apply to your jobs, their profiles and contact details will appear here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        ${allCandidates.map(item => `
          <div class="job-card" style="padding:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border-light);">
              <div>
                <span style="font-size:11px;color:var(--text-tertiary);font-weight:700;">Applied for Job:</span>
                <strong style="font-size:13px;display:block;color:var(--primary);">${escapeHtml(item.job.title)}</strong>
              </div>
              <div class="price-pill" style="font-size:13px;padding:2px 8px;">₹${item.job.payment}</div>
            </div>
            ${renderCandidateCard(item.candidate, item.job)}
          </div>
        `).join('')}
      </div>
    `;
  }
}

function renderCandidateCard(candidate, job) {
  const cleanPhone = (candidate.worker_phone || '').replace(/[^0-9]/g, '');
  const initial = (candidate.worker_name || 'W').charAt(0).toUpperCase();
  const safeProofUrl = candidate.proof_url ? (candidate.proof_url.startsWith('http') ? candidate.proof_url : `${API_BASE}${candidate.proof_url}`) : null;

  // Status badge config
  let statusBadge = `<span class="badge badge-applied">🟡 Applied</span>`;
  if (candidate.status === 'started') {
    statusBadge = `<span class="badge badge-started">🔵 Shift in Progress</span>`;
  } else if (candidate.status === 'submitted') {
    statusBadge = `<span class="badge badge-submitted">🟣 Proof Uploaded</span>`;
  } else if (candidate.status === 'approved') {
    statusBadge = `<span class="badge badge-approved">🟢 Approved & Paid</span>`;
  }

  // Skills chips
  let skillsChips = '';
  if (candidate.worker_skills) {
    try {
      const parsed = typeof candidate.worker_skills === 'string' && candidate.worker_skills.startsWith('[')
        ? JSON.parse(candidate.worker_skills)
        : candidate.worker_skills.split(',');
      if (Array.isArray(parsed)) {
        skillsChips = parsed.map(s => `<span class="candidate-skill-chip">${escapeHtml(s.trim())}</span>`).join(' ');
      }
    } catch (e) {
      skillsChips = `<span class="candidate-skill-chip">${escapeHtml(candidate.worker_skills)}</span>`;
    }
  }

  // Action button based on state
  let actionBtn = '';
  if (candidate.status === 'submitted') {
    actionBtn = `
      <button class="btn btn-primary btn-sm" onclick="openProofVerification('${job.id}', '${candidate.worker_id}', '${safeProofUrl || ''}', '${escapeHtml(candidate.worker_name)}', '${escapeHtml(candidate.worker_phone)}', '${escapeHtml(job.title)}', ${job.payment})">
        🔍 Review Work Proof →
      </button>
    `;
  } else if (candidate.status === 'applied') {
    actionBtn = `
      <a href="tel:${candidate.worker_phone || ''}" class="btn btn-primary btn-sm">
        📞 Hire / Call Worker
      </a>
    `;
  } else if (candidate.status === 'approved') {
    actionBtn = `
      <span style="color:var(--primary);font-size:12px;font-weight:800;display:inline-flex;align-items:center;gap:4px;">
        ✓ ₹${job.payment} Paid to Worker
      </span>
    `;
  } else if (candidate.status === 'started') {
    actionBtn = `
      <span style="color:var(--secondary);font-size:12px;font-weight:700;">
        ⏱ Working on-site now
      </span>
    `;
  }

  // Proof thumbnail preview if submitted
  let proofThumbnail = '';
  if (safeProofUrl && (candidate.status === 'submitted' || candidate.status === 'approved')) {
    proofThumbnail = `
      <div class="proof-thumbnail-row">
        <img src="${safeProofUrl}" alt="Proof" class="proof-thumbnail-img" onclick="openProofVerification('${job.id}', '${candidate.worker_id}', '${safeProofUrl}', '${escapeHtml(candidate.worker_name)}', '${escapeHtml(candidate.worker_phone)}', '${escapeHtml(job.title)}', ${job.payment})">
        <div style="font-size:11px;">
          <strong>Work Completion Photo</strong><br>
          <span style="color:var(--text-secondary);">GPS Tagged • Click to view full proof</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="candidate-card">
      <div class="candidate-header-row">
        <div class="candidate-profile-info">
          <div class="candidate-avatar">${initial}</div>
          <div>
            <div class="candidate-name">${escapeHtml(candidate.worker_name || 'Worker')}</div>
            <div class="candidate-role-sub">${escapeHtml(candidate.worker_category || 'Micro-Job Worker')} • Applied: ${candidate.applied_at || 'Recently'}</div>
          </div>
        </div>
        <div>
          ${statusBadge}
        </div>
      </div>

      ${skillsChips ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin:2px 0;">${skillsChips}</div>` : ''}

      ${proofThumbnail}

      <div class="candidate-actions-row" style="justify-content:space-between;">
        <div style="display:flex;gap:6px;align-items:center;">
          ${cleanPhone ? `
            <a href="tel:${candidate.worker_phone}" class="btn-contact btn-call">
              📞 Call (${candidate.worker_phone})
            </a>
            <a href="https://wa.me/91${cleanPhone}?text=${encodeURIComponent(`Hello ${candidate.worker_name}, regarding your application for '${job.title}' on WorkNear...`)}" target="_blank" class="btn-contact btn-whatsapp">
              💬 WhatsApp
            </a>
          ` : '<span style="font-size:11px;color:var(--text-tertiary);">No phone recorded</span>'}
        </div>
        <div>
          ${actionBtn}
        </div>
      </div>
    </div>
  `;
}

function openProofVerification(jobId, workerId, proofUrl, workerName, workerPhone, jobTitle, payment) {
  state.selectedVerification = {
    jobId,
    workerId,
    proofUrl,
    workerName,
    workerPhone,
    jobTitle,
    payment
  };

  if ($('verificationJobDesc')) {
    $('verificationJobDesc').textContent = `${workerName} submitted completion proof for '${jobTitle}' (₹${payment}).`;
  }
  if ($('verificationProofImg')) {
    $('verificationProofImg').src = proofUrl || 'https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=600&q=80';
  }
  if ($('verificationWorkerInfo')) {
    $('verificationWorkerInfo').innerHTML = `
      <strong>Candidate Worker:</strong><br>
      <span>${escapeHtml(workerName)} • Phone: <a href="tel:${workerPhone}" style="color:var(--primary);font-weight:700;">${workerPhone}</a></span><br>
      <small style="color:var(--text-secondary);">Agreed Payout: ₹${payment}</small>
    `;
  }
  if ($('verificationApproveBtn')) {
    $('verificationApproveBtn').textContent = `✓ Approve & Release ₹${payment}`;
  }

  navigateTo('screenEmployerVerification');
}

async function approveAndReleasePaymentAction() {
  if (!state.selectedVerification || !state.selectedVerification.jobId) {
    showToast("No active job verification selected", "⚠️");
    return;
  }

  const { jobId, workerId, workerName, payment } = state.selectedVerification;

  try {
    showToast("Releasing payment to worker...", "⏳");
    const res = await fetch(`${API_BASE}/jobs/${jobId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: workerId })
    });

    if (res.ok) {
      showToast(`🎉 ₹${payment} released to ${workerName}! Work approved.`, "✓", 4000);
      await renderEmployerJobs();
      navigateTo('screenEmployerHome');
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || "Approval failed", "❌");
    }
  } catch (e) {
    console.error("Payment release error", e);
    showToast("Failed to connect to backend", "❌");
  }
}

async function rejectWorkProofAction() {
  if (!state.selectedVerification || !state.selectedVerification.jobId) {
    showToast("No active job verification selected", "⚠️");
    return;
  }

  const { jobId, workerId, workerName } = state.selectedVerification;

  try {
    showToast("Requesting re-do from worker...", "⏳");
    const res = await fetch(`${API_BASE}/jobs/${jobId}/reject-proof`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: workerId })
    });

    if (res.ok) {
      showToast(`Proof rejected. ${workerName} requested to re-submit proof.`, "⚠️", 3500);
      await renderEmployerJobs();
      navigateTo('screenEmployerHome');
    } else {
      showToast("Could not reject proof on server", "❌");
    }
  } catch (e) {
    console.error("Reject error", e);
    showToast("Failed to connect to backend", "❌");
  }
}

// Global aliases for DOM event handlers
window.loadEmployerJobs = renderEmployerJobs;
window.renderEmployerJobs = renderEmployerJobs;
window.fillJobTemplate = fillJobTemplate;
window.publishNewJob = publishNewJob;
window.switchEmployerTab = switchEmployerTab;
window.useCurrentLocationForNewJob = useCurrentLocationForNewJob;
window.updateLiveJobPreview = updateLiveJobPreview;
window.openProofVerification = openProofVerification;
window.approveAndReleasePaymentAction = approveAndReleasePaymentAction;
window.rejectWorkProofAction = rejectWorkProofAction;

// ------------------------------------------------------------------------------
// GEOLOCATION DETECTION (HTML5)
// ------------------------------------------------------------------------------
function detectLiveLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.userCoords = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude
        };
      },
      err => {
        console.log("Using default coordinates (Chennai Central).");
      }
    );
  }
}

function clearNotifications() {
  const badge = $('notifBadge');
  if (badge) badge.style.display = 'none';
  showToast("All notifications marked read");
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

