/* Split public-site presentation controls from operational store settings. */
(()=>{
  const $=selector=>document.querySelector(selector);
  const contentDefaults={heroEyebrow:'今日の小さなごほうび',heroTitle:'把喜欢的零食，',heroEmphasis:'装进日常里。',heroIntro:'从童年味道到新鲜人气款，挑一袋让心情变好的中国零食。下单即为您预留，无需在线付款。',heroButton:'开始挑选',footerHours:'营业时间：每日 10:00 – 21:00',footerYear:'2026'};
  const deliveryDefaults={deliveryEyebrow:'LOCAL DELIVERY',deliveryTitle:'把零食送到你身边',deliveryStampTop:'DELIVERY',deliveryStampBottom:'CHICAGO',deliveryBackgroundColor:'#f4e9d2'};
  const imageKeys=['heroBackgroundImage','storyBackgroundImage','deliveryStampImage','deliveryBackgroundImage'];
  const toast=message=>{const node=$('#toast');if(!node)return;node.textContent=message;node.classList.add('show');setTimeout(()=>node.classList.remove('show'),2800);};
  const inputValue=(id,fallback)=>$(id)?.value.trim()||fallback;

  function ensureShell(){
    const nav=$('aside nav'),settingsButton=$('[data-view="settings"]'),settings=$('#settings');
    if(!nav||!settingsButton||!settings)return false;
    settingsButton.textContent='店铺设置';
    if(!$('[data-view="appearance"]')){
      settingsButton.insertAdjacentHTML('afterend','<button data-view="appearance">店铺外观</button>');
      settings.insertAdjacentHTML('afterend','<section class="view" id="appearance"><div class="panel narrow appearance-panel"><h2>店铺外观</h2><p class="muted">管理顾客网站的首页、配送区域和页尾文案、插画与背景图片。</p><form id="appearanceForm"><div id="appearanceFields"><p class="muted">正在加载外观设置…</p></div><button class="primary" type="submit">保存店铺外观</button></form></div></section>');
      $('[data-view="appearance"]').addEventListener('click',()=>{document.querySelectorAll('aside nav button,.view').forEach(node=>node.classList.remove('active'));$('[data-view="appearance"]').classList.add('active');$('#appearance')?.classList.add('active');$('#pageTitle').textContent='店铺外观';});
    }
    return true;
  }

  function setupAppearanceMenu(){
    const nav=$('aside nav'),button=$('[data-view="appearance"]');if(!nav||!button||$('#appearanceSubmenu'))return;
    button.classList.add('settings-parent-toggle');button.setAttribute('aria-expanded','false');
    button.insertAdjacentHTML('afterend','<div class="store-settings-submenu" id="appearanceSubmenu"><button type="button" data-appearance-pane="hero">首页装修</button><button type="button" data-appearance-pane="announcement">活动公告</button><button type="button" data-appearance-pane="products">商品展示</button><button type="button" data-appearance-pane="delivery">配送区域</button><button type="button" data-appearance-pane="footer">页尾设置</button></div>');
    const menu=$('#appearanceSubmenu');button.addEventListener('click',()=>{const open=!menu.classList.contains('open');menu.classList.toggle('open',open);button.classList.toggle('expanded',open);button.setAttribute('aria-expanded',String(open));});
    menu.addEventListener('click',e=>{const item=e.target.closest('[data-appearance-pane]');if(!item)return;document.querySelectorAll('aside nav button,.view').forEach(x=>x.classList.remove('active'));button.classList.add('active');$('#appearance').classList.add('active');$('#pageTitle').textContent='店铺外观';showPane(item.dataset.appearancePane);menu.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===item));});
  }
  function showPane(name){const map={hero:['heroContentSettings'],delivery:['deliveryContentSettings'],footer:['footerContentSettings'],announcement:['appearanceAnnouncement'],products:['appearanceProducts']};Object.values(map).flat().forEach(id=>{const el=$('#'+id);if(el)el.hidden=true;});(map[name]||[]).forEach(id=>{const el=$('#'+id);if(el)el.hidden=false;});const images=$('#imageSettings');if(images)images.hidden=!['hero','delivery','footer'].includes(name);}
  function extraControls(){const target=$('#appearanceFields');if(!target||$('#appearanceAnnouncement'))return;target.insertAdjacentHTML('beforeend','<section id="appearanceAnnouncement"><h3>活动公告</h3><p class="muted">顾客网站首页首屏下方会自动显示全部进行中的活动；没有活动时自动隐藏。</p></section><section id="appearanceProducts"><h3>商品展示</h3><p class="muted">选择样式后会同步顾客网站；其余布局独立设置。</p><div class="appearance-style-picker" id="cardStylePicker"><button type="button" data-card-style="japanese"><i></i>日式简约</button><button type="button" data-card-style="cute"><i></i>可爱圆润</button><button type="button" data-card-style="clean"><i></i>清爽无框</button><button type="button" data-card-style="classic"><i></i>经典卡片</button></div><div class="two"><label>商品图片比例<select id="appearanceImageFit"><option value="contain">完整显示</option><option value="cover">铺满裁剪</option></select></label><label>电脑端每行商品数量<select id="appearanceDesktopCols"><option>3</option><option selected>4</option><option>5</option></select></label></div><div class="two"><label>手机端每行商品数量<select id="appearanceMobileCols"><option>1</option><option selected>2</option><option>3</option></select></label><label class="rule-switch"><input id="appearanceShowDescription" type="checkbox" checked>显示商品描述</label></div></section>');const css='<style>.appearance-style-picker{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:12px 0}.appearance-style-picker button{padding:10px 5px;border:1px solid var(--line);background:#fffdf8;cursor:pointer;font:12px inherit}.appearance-style-picker i{display:block;height:36px;margin:0 5px 7px;background:#f1e7d5;border-radius:3px}.appearance-style-picker button[data-card-style="cute"] i{border-radius:13px}.appearance-style-picker button[data-card-style="clean"] i{background:linear-gradient(90deg,#f1e7d5 45%,transparent 45%)}.appearance-style-picker button[data-card-style="classic"] i{border:1px solid #a99f8d}.appearance-style-picker button.active{outline:2px solid var(--sage)}@media(max-width:720px){.appearance-style-picker{grid-template-columns:1fr 1fr}}</style>';document.head.insertAdjacentHTML('beforeend',css);}
  async function bindAdvanced(){const form=$('#appearanceForm');if(!form||form.dataset.advanced)return;form.dataset.advanced='true';const db=window.supabase.createClient(window.TINGS_SUPABASE.url,window.TINGS_SUPABASE.anonKey),{data}=await db.from('shop_settings').select('content').eq('id',1).maybeSingle(),c={cardStyle:'japanese',imageFit:'contain',desktopCols:4,mobileCols:2,showDescription:true,...(data?.content?.siteAppearance||{})};const pick=v=>{$('#cardStylePicker')?.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x.dataset.cardStyle===v));};pick(c.cardStyle);$('#appearanceImageFit').value=c.imageFit;$('#appearanceDesktopCols').value=c.desktopCols;$('#appearanceMobileCols').value=c.mobileCols;$('#appearanceShowDescription').checked=c.showDescription!==false;$('#cardStylePicker').onclick=e=>{const b=e.target.closest('[data-card-style]');if(b){c.cardStyle=b.dataset.cardStyle;pick(c.cardStyle)}};form.addEventListener('submit',()=>setTimeout(async()=>{const {data:now}=await db.from('shop_settings').select('content').eq('id',1).maybeSingle();await db.from('shop_settings').update({content:{...(now?.content||{}),siteAppearance:{...c,imageFit:$('#appearanceImageFit').value,desktopCols:+$('#appearanceDesktopCols').value,mobileCols:+$('#appearanceMobileCols').value,showDescription:$('#appearanceShowDescription').checked}}}).eq('id',1)},0));}

  function moveAppearanceFields(){
    const source=$('#settingsForm'),target=$('#appearanceFields');
    const sections=['heroContentSettings','deliveryContentSettings','footerContentSettings','imageSettings'].map(id=>$('#'+id));
    if(!source||!target||sections.some(section=>!section))return false;
    if(!target.dataset.moved){
      sections.forEach(section=>target.append(section));
      source.querySelectorAll(':scope > hr').forEach(rule=>rule.remove());
      target.dataset.moved='true';
    }
    return true;
  }

  async function saveAppearance(event){
    event.preventDefault();
    const source=$('#settingsForm');
    if(!source||!window.supabase||!window.TINGS_SUPABASE)return;
    const content={};
    Object.entries(contentDefaults).forEach(([key,fallback])=>{content[key]=inputValue('#'+key+'Input',fallback);});
    Object.entries(deliveryDefaults).forEach(([key,fallback])=>{content[key]=inputValue('#'+key+'Input',fallback);});
    imageKeys.forEach(key=>{content[key]=source.dataset[key]||'';});
    const fee=Number($('#deliveryFeeInput')?.value||5),free=Number($('#freeDeliveryInput')?.value||50),delivery=inputValue('#deliveryText',`配送费 $${fee.toFixed(2)}；商品小计满 $${free.toFixed(2)} 免费配送。`);
    const db=window.supabase.createClient(window.TINGS_SUPABASE.url,window.TINGS_SUPABASE.anonKey);
    const {data:current}=await db.from('shop_settings').select('content').eq('id',1).maybeSingle();
    const {error}=await db.from('shop_settings').update({delivery,content:{...(current?.content||{}),...content},updated_at:new Date().toISOString()}).eq('id',1);
    toast(error?error.message:'店铺外观已保存');
  }

  function bindAppearanceForm(){
    const form=$('#appearanceForm');
    if(!form||form.dataset.bound)return;
    form.dataset.bound='true';
    form.addEventListener('submit',saveAppearance);
  }

  function setup(){
    if(!ensureShell())return setTimeout(setup,150);
    if(!moveAppearanceFields())return setTimeout(setup,180);
    extraControls();setupAppearanceMenu();bindAppearanceForm();bindAdvanced();
  }

  window.addEventListener('load',()=>setTimeout(setup,220));
})();
