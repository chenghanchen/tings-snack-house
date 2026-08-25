/* Compact navigation for the owner dashboard on phones. */
(()=>{
  const aside=document.querySelector('aside');
  const toggle=document.querySelector('#mobileNavToggle');
  const backdrop=document.querySelector('#mobileNavBackdrop');
  const title=document.querySelector('#mobileNavTitle');
  if(!aside||!toggle||!backdrop||!title)return;
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
    title.textContent=button.textContent.replace(/\d+/g,'').trim();
    close();
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
})();
