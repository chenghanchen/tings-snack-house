(()=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const socialNames={instagram:'Instagram',facebook:'Facebook',xiaohongshu:'小红书',wechat:'微信'};
  const defaults={showPhone:true,showEmail:true,socials:{instagram:{show:false,qr:''},facebook:{show:false,qr:''},xiaohongshu:{show:false,qr:''},wechat:{show:false,qr:''}}};
  function css(){
    if(document.querySelector('#footerContactOverlayStyles'))return;
    document.head.insertAdjacentHTML('beforeend','<style id="footerContactOverlayStyles">#story.footer-composite{position:relative;isolation:isolate}#story.footer-composite .footer-contact-overlay{position:absolute;z-index:3;left:0;right:0;bottom:0;padding:16px max(5vw,28px);background:linear-gradient(90deg,#24180ee0,#3a2517b8);color:#fff9ed;display:grid;gap:9px}#story.footer-composite .footer-contact-list{display:flex;align-items:center;gap:20px;flex-wrap:wrap;font-size:13px}#story.footer-composite .footer-contact-list a{color:inherit;text-decoration:none;white-space:nowrap}#story.footer-composite .footer-social-list{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap}.footer-social-item{position:relative}.footer-social-toggle{border:1px solid #fff8e099;background:#ffffff18;color:#fff9ed;padding:6px 10px;cursor:pointer;font:12px inherit}.footer-social-toggle[aria-expanded=true]{background:#ffffff32}.footer-social-qr{position:absolute;z-index:4;left:0;bottom:calc(100% + 8px);width:126px;padding:7px;background:#fffdf8;border:1px solid #e4d8c6;box-shadow:0 8px 22px #0005}.footer-social-qr img{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:contain}.footer-social-qr[hidden]{display:none}@media(max-width:780px){#story.footer-composite{aspect-ratio:4/3}#story.footer-composite .footer-contact-overlay{padding:12px 7vw;gap:8px}#story.footer-composite .footer-contact-list{display:flex;flex-direction:row;align-items:center;gap:12px;flex-wrap:wrap;font-size:12px}#story.footer-composite .footer-social-list{gap:6px}.footer-social-toggle{padding:5px 8px;font-size:11px}}</style>');
  }
  function render(settings){
    const content=settings.content||{},profile=content.storeSettings?.profile||{},saved=content.footerAppearance||{},config={...defaults,...saved,socials:{...defaults.socials,...(saved.socials||{})}};
    const contacts=[];
    if(config.showPhone!==false&&profile.phone)contacts.push(`<a href="tel:${esc(profile.phone)}">电话：${esc(profile.phone)}</a>`);
    if(config.showEmail!==false&&profile.email)contacts.push(`<a href="mailto:${esc(profile.email)}">邮箱：${esc(profile.email)}</a>`);
    const social=Object.entries(config.socials).filter(([,value])=>value?.show).map(([id,value])=>`<div class="footer-social-item"><button type="button" class="footer-social-toggle" data-footer-social="${id}" aria-expanded="false">${socialNames[id]}</button><div class="footer-social-qr" id="footerQr_${id}" hidden>${value.qr?`<img src="${value.qr}" alt="${socialNames[id]} 二维码">`:'<span>暂未设置二维码</span>'}</div></div>`).join('');
    if(!contacts.length&&!social)return;
    const story=document.querySelector('#story');
    if(!story||story.querySelector('.footer-contact-overlay'))return;
    css();
    story.insertAdjacentHTML('beforeend',`<div class="footer-contact-overlay"><div class="footer-contact-list">${contacts.join('')}</div>${social?`<div class="footer-social-list">${social}</div>`:''}</div>`);
    story.querySelector('.footer-contact-overlay').addEventListener('click',event=>{const button=event.target.closest('[data-footer-social]');if(!button)return;const panel=story.querySelector(`#footerQr_${button.dataset.footerSocial}`),open=button.getAttribute('aria-expanded')==='true';story.querySelectorAll('.footer-social-toggle').forEach(node=>node.setAttribute('aria-expanded','false'));story.querySelectorAll('.footer-social-qr').forEach(node=>node.hidden=true);button.setAttribute('aria-expanded',String(!open));if(panel)panel.hidden=open;});
  }
  async function start(){
    if(!window.supabase||!window.TINGS_SUPABASE)return setTimeout(start,150);
    const db=window.supabase.createClient(window.TINGS_SUPABASE.url,window.TINGS_SUPABASE.anonKey),{data,error}=await db.from('shop_settings').select('content').eq('id',1).maybeSingle();
    if(!error&&data)render(data);
  }
  window.addEventListener('load',()=>setTimeout(start,260));
})();
