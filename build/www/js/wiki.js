// Enhanced wiki client helpers: live reload, AJAX search/category handling
// requires socket.io client library and jQuery

(function(){
    // live-reload on updates
    if (typeof io !== 'undefined') {
        const socket = io();
        socket.on('wiki:update', function (data) {
            if (location.pathname.startsWith('/wiki')) location.reload();
        });
    }

    // centralized AJAX search: if a search box exists, bind dynamic search
    function ajaxSearch(q, category, extraParams) {
        const params = extraParams || {};
        if (q) params.search = q;
        if (category) params.category = category;
        $.get('/api/wiki', params).done(function(list){
            if (typeof renderArticles === 'function') return renderArticles(list);
            const container = $('#articles');
            if (!container.length) return;
            container.empty();
            if (!list.length) { container.append('<p>No articles.</p>'); return; }
            list.forEach(a => {
                container.append(`<hr><h3>${a.title}</h3><p>${a.content}</p><p><em>by ${a.author||'anonymous'}</em></p>`);
            });
        });
    }

    // account rendering: show username + logout in navbar (top-right)
    function renderAccountArea(user) {
        const navRight = $('ul.navbar-nav.navbar-right');
        if (!navRight.length) return;
        // remove previous account li if present
        navRight.find('.account-li').remove();
        if (user && user.user) {
            // hide login/signup links
            navRight.find('a[href="/wiki/login.html"]').closest('li').hide();
            navRight.find('a[href="/wiki/signup.html"]').closest('li').hide();
            const li = $(`<li class="account-li"><a href="#">Signed in as <strong>${user.user}</strong></a></li>`);
            const logoutLi = $(`<li class="account-li"><a href="#" id="logout-btn">Logout</a></li>`);
            navRight.append(li).append(logoutLi);
            $('#logout-btn').on('click', function(e){ e.preventDefault(); $.post('/logout').always(function(){ location.reload(); }); });
        } else {
            // ensure login/signup visible
            navRight.find('a[href="/wiki/login.html"]').closest('li').show();
            navRight.find('a[href="/wiki/signup.html"]').closest('li').show();
        }
    }

    $(function(){
        // wire search button if present
        if ($('#searching').length) {
            $('#searching').off('click').on('click', function(){
                const q = $('input[name="x"]').val();
                ajaxSearch(q);
            });
        }

        // category dropdown links: intercept and do AJAX search by category
        $(document).on('click', '.dropdown-menu a', function(e){
            const href = $(this).attr('href');
            if (!href) return;
            if (href.startsWith('/wiki/search/')) {
                e.preventDefault();
                const cat = decodeURIComponent(href.split('/').pop());
                ajaxSearch('', cat);
            }
        });

        // check authenticated user and update UI (hide login/signup, show account)
        $.get('/api/me').done(function(resp){ renderAccountArea(resp); }).fail(function(){ renderAccountArea(null); });
    });
})();
