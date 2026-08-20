(()=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const socialNames={instagram:'Instagram',facebook:'Facebook',xiaohongshu:'Xiaohongshu',wechat:'Wechat'};
  const defaults={showPhone:true,showEmail:true,socials:{instagram:{show:false,qr:''},facebook:{show:false,qr:''},xiaohongshu:{show:false,qr:''},wechat:{show:false,qr:''}}};
  function css(){
    if(document.querySelector('#footerContactOverlayStyles'))return;
    document.head.insertAdjacentHTML('beforeend','<style id="footerContactOverlayStyles">.footer-contact-bar{padding:14px max(5vw,28px);background:#fbf6eb;border-bottom:1px solid #ded5c5;color:#493c31;display:flex;align-items:center;gap:20px;flex-wrap:wrap}.footer-contact-bar .footer-contact-list,.footer-contact-bar .footer-social-list{display:flex;align-items:center;gap:20px;flex-wrap:wrap;font-size:14px}.footer-contact-bar .footer-contact-list a{color:inherit;text-decoration:none;white-space:nowrap}.footer-contact-bar .footer-social-list{gap:10px}.footer-social-item{position:relative}.footer-social-toggle{border:1px solid #aa9780;background:#fffdf8;color:#493c31;padding:6px 10px;cursor:pointer;font:14px inherit}.footer-social-toggle[aria-expanded=true]{background:#eee1ca}.footer-social-qr{position:absolute;z-index:4;left:0;bottom:calc(100% + 8px);width:126px;padding:7px;background:#fffdf8;border:1px solid #e4d8c6;box-shadow:0 8px 22px #0005}.footer-social-qr img{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:contain}.footer-social-qr[hidden]{display:none}@media(max-width:780px){.footer-contact-bar{padding:12px 7vw;gap:12px;flex-wrap:nowrap;overflow-x:auto}.footer-contact-bar .footer-contact-list,.footer-contact-bar .footer-social-list{gap:12px;flex-wrap:nowrap;white-space:nowrap;font-size:12px}.footer-social-toggle{padding:5px 8px;font-size:12px}}</style>');
  }
  function render(settings){
    const content=settings.content||{},profile=content.storeSettings?.profile||{},saved=content.footerAppearance||{},config={...defaults,...saved,socials:{...defaults.socials,...(saved.socials||{})}};
    const contacts=[];
    if(config.showPhone!==false&&profile.phone)contacts.push(`<a href="tel:${esc(profile.phone)}">电话：${esc(profile.phone)}</a>`);
    if(config.showEmail!==false&&profile.email)contacts.push(`<a href="mailto:${esc(profile.email)}">邮箱：${esc(profile.email)}</a>`);
    const social=Object.entries(config.socials).filter(([,value])=>value?.show).map(([id,value])=>`<div class="footer-social-item"><button type="button" class="footer-social-toggle" data-footer-social="${id}" aria-expanded="false">${socialNames[id]}</button><div class="footer-social-qr" id="footerQr_${id}" hidden>${value.qr?`<img src="${value.qr}" alt="${socialNames[id]} 二维码">`:'<span>暂未设置二维码</span>'}</div></div>`).join('');
    if(!contacts.length&&!social)return;
    const story=document.querySelector('#story');
    if(!story||document.querySelector('.footer-contact-bar'))return;
    css();
    story.insertAdjacentHTML('afterend',`<section class="footer-contact-bar" aria-label="联系方式"><div class="footer-contact-list">${contacts.join('')}</div>${social?`<div class="footer-social-list">${social}</div>`:''}</section>`);
    const bar=document.querySelector('.footer-contact-bar');
    bar.addEventListener('click',event=>{const button=event.target.closest('[data-footer-social]');if(!button)return;const panel=bar.querySelector(`#footerQr_${button.dataset.footerSocial}`),open=button.getAttribute('aria-expanded')==='true';bar.querySelectorAll('.footer-social-toggle').forEach(node=>node.setAttribute('aria-expanded','false'));bar.querySelectorAll('.footer-social-qr').forEach(node=>node.hidden=true);button.setAttribute('aria-expanded',String(!open));if(panel)panel.hidden=open;});
  }
  async function start(){
    if(!window.supabase||!window.TINGS_SUPABASE)return setTimeout(start,150);
    const db=window.supabase.createClient(window.TINGS_SUPABASE.url,window.TINGS_SUPABASE.anonKey),{data,error}=await db.from('shop_settings').select('content').eq('id',1).maybeSingle();
    if(!error&&data)render(data);
  }
  window.addEventListener('load',()=>setTimeout(start,260));
})();
