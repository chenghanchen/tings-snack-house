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
    const subsection=event.target.closest('[data-store-section],[data-appearance-pane]');
    if(subsection){
      title.textContent=subsection.hasAttribute('data-store-section')?'店铺设置':'店铺外观';
      close();
      return;
    }
    const button=event.target.closest('[data-view]');
    if(!button)return;
    title.textContent=button.textContent.replace(/\d+/g,'').trim();
    /* Parent items must keep their native click handlers so their submenus open. */
    if(button.dataset.view!=='settings'&&button.dataset.view!=='appearance')close();
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
})();
