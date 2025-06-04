// 语言切换功能
document.addEventListener('DOMContentLoaded', function() {
    const langToggle = document.getElementById('langToggle');
    const body = document.body;

    langToggle.addEventListener('click', function() {
        body.classList.toggle('en');
        langToggle.textContent = body.classList.contains('en') ? '中' : 'EN';
    });

    // 移动端菜单
    const mobileMenu = document.querySelector('.mobile-menu');
    const navLinks = document.querySelector('.nav-links');

    mobileMenu.addEventListener('click', function() {
        navLinks.style.display = navLinks.style.display === 'flex' ? 'none' : 'flex';
    });

    // 平滑滚动
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
                // 如果在移动端，点击后关闭菜单
                if (window.innerWidth <= 768) {
                    navLinks.style.display = 'none';
                }
            }
        });
    });

    // 响应式导航栏
    window.addEventListener('resize', function() {
        if (window.innerWidth > 768) {
            navLinks.style.display = 'flex';
        } else {
            navLinks.style.display = 'none';
        }
    });

    // 滚动时导航栏效果
    let lastScroll = 0;
    const header = document.querySelector('header');

    window.addEventListener('scroll', function() {
        const currentScroll = window.pageYOffset;

        if (currentScroll <= 0) {
            header.classList.remove('scroll-up');
            return;
        }

        if (currentScroll > lastScroll && !header.classList.contains('scroll-down')) {
            // 向下滚动
            header.classList.remove('scroll-up');
            header.classList.add('scroll-down');
        } else if (currentScroll < lastScroll && header.classList.contains('scroll-down')) {
            // 向上滚动
            header.classList.remove('scroll-down');
            header.classList.add('scroll-up');
        }
        lastScroll = currentScroll;
    });

    // 点击吸入装置使用指导卡片时，阻止锚点跳转，自动弹出Dify气泡机器人对话框
    var inhalerCard = document.querySelector('.feature-card[href="#guide"]');
    if (inhalerCard) {
        inhalerCard.addEventListener('click', function(e) {
            e.preventDefault(); // 阻止锚点跳转
            var bubbleBtn = document.getElementById('dify-chatbot-bubble-button');
            if (bubbleBtn) {
                bubbleBtn.click();
            }
        });
    }

    // 移动端导航菜单
    const mobileMenuBtn = document.querySelector('.mobile-menu');
    const mobileNav = document.createElement('div');
    mobileNav.className = 'mobile-nav';
    const navItems = Array.from(navLinks.children).map(item => item.cloneNode(true));
    navItems.forEach(item => mobileNav.appendChild(item));
    document.body.appendChild(mobileNav);

    // 切换移动端菜单
    mobileMenuBtn.addEventListener('click', function() {
        mobileNav.classList.toggle('active');
    });

    // 点击菜单项后关闭菜单
    mobileNav.addEventListener('click', function(e) {
        if (e.target.tagName === 'A') {
            mobileNav.classList.remove('active');
        }
    });

    // 微信环境检测
    function isWeixinBrowser() {
        const ua = navigator.userAgent.toLowerCase();
        return ua.indexOf('micromessenger') !== -1;
    }

    // 如果在微信环境中，添加特定类
    if (isWeixinBrowser()) {
        document.body.classList.add('weixin-browser');
    }
});

// Dify API 聊天功能（修正版，支持多轮对话）
(function() {
    const difyForm = document.getElementById('dify-form');
    const difyInput = document.getElementById('dify-input');
    const difyMessages = document.getElementById('dify-messages');
    const DIFY_API_URL = '';
    const DIFY_API_KEY = '';
    let conversationId = null; // 用于多轮对话

    if (difyForm && difyInput && difyMessages) {
        difyForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const userMsg = difyInput.value.trim();
            if (!userMsg) return;

            appendMessage(userMsg, 'user');
            difyInput.value = '';
            difyInput.disabled = true;

            // 构造请求体
            const body = {
                inputs: {},
                query: userMsg,
                response_mode: 'blocking'
            };
            if (conversationId) body.conversation_id = conversationId;

            try {
                const response = await fetch(DIFY_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${DIFY_API_KEY}`
                    },
                    body: JSON.stringify(body)
                });
                const data = await response.json();
                // 保存 conversation_id 以便多轮对话
                if (data.conversation_id) conversationId = data.conversation_id;
                let botMsg = data.answer || '很抱歉，未能获取到回复。';
                appendMessage(botMsg, 'bot');
            } catch (err) {
                appendMessage('请求失败，请稍后重试。', 'bot');
            }
            difyInput.disabled = false;
            difyInput.focus();
        });

        function appendMessage(text, type) {
            const div = document.createElement('div');
            div.className = 'dify-message ' + type;
            div.textContent = text;
            difyMessages.appendChild(div);
            difyMessages.scrollTop = difyMessages.scrollHeight;
        }
    }
})(); 