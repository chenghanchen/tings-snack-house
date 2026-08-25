/* Compact navigation for the owner dashboard on phones. */
(()=>{
  const aside=document.querySelector('aside');
  const toggle=document.querySelector('#mobileNavToggle');
  const backdrop=document.querySelector('#mobileNavBackdrop');
  const title=document.querySelector('#mobileNavTitle');
  if(!aside||!toggle||!backdrop||!title)return;
  /* Keep the drawer above its dimming backdrop on small screens. */
  aside.style.zIndex='42';
  const close=()=>{
    document.body.classList.remove('mobile-nav-open');
    toggle.setAttribute('aria-expanded','false');
    toggle.setAttribute('aria-label','打开后台导航');
  };
  const open=()=>{
    document.body.classList.add('mobile-nav-open');
    toggle.setAttribute('aria-expanded','true');
    toggle.setAttribute('aria-label','关闭后台导航');
  };
  toggle.addEventListener('click',()=>document.body.classList.contains('mobile-nav-open')?close():open());
  backdrop.addEventListener('click',close);
  aside.querySelector('nav')?.addEventListener('click',event=>{
    const button=event.target.closest('[data-view]');
    if(!button)return;
    /* Run the established page switcher directly, then consume this click once. */
    event.preventDefault();
    event.stopImmediatePropagation();
    if(typeof button.onclick==='function')button.onclick.call(button,event);
    else{
      document.querySelectorAll('aside nav button,.view').forEach(node=>node.classList.remove('active'));
      button.classList.add('active');
      document.querySelector('#'+button.dataset.view)?.classList.add('active');
      const pageTitle=document.querySelector('#pageTitle');
      if(pageTitle)pageTitle.textContent=button.textContent.replace(/\d+/g,'').trim();
    }
    title.textContent=button.textContent.replace(/\d+/g,'').trim();
    close();
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
})();
