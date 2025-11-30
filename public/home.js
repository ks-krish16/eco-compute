

const user = JSON.parse(localStorage.getItem('eco_user') || 'null');
if (user) {
    // display in any element
    const welcome = document.getElementById('welcomeName');
    const signup = document.getElementById('signup');
    const role = localStorage.getItem('role')
    const getStarted = document.getElementById('getStarted')
    // create this <span> in HTML
    if (welcome && signup) {
        welcome.innerText = "Welcome, " + user.username
        welcome.style.display = ''
        signup.style.display = 'none'

    };
    if (role && getStarted) {
        if (role == "provider") {
            getStarted.innerText = "Hello, provider"
            getStarted.href = "/provider"
        }
        if (role == "requester") {
            getStarted.innerText = "Hello, requester"
            getStarted.href = "/recruit"
        }
    }
}

function logout() {
    alert("do you want to logout?   ")
    localStorage.removeItem('eco_user');
    window.location.href = '/';
}

(function () {
    const splash = document.getElementById('splash');
    const page = document.getElementById('page');
    const splashSeconds = 3.5;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        splash.classList.add('hidden');
        page.classList.add('visible');
        return;
    }

    setTimeout(() => {
        splash.classList.add('hidden');
        setTimeout(() => page.classList.add('visible'), 300);
    }, splashSeconds * 1000);

    splash.addEventListener('click', () => {
        splash.classList.add('hidden');
        setTimeout(() => page.classList.add('visible'), 300);
    });
})();

