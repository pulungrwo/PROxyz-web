(()=>{
  const LOAD_STEP=50;
  const token=document.body.dataset.galleryToken;
  const liveManifest=document.body.dataset.liveManifest||'';
  const titleEl=document.getElementById('gallery-title');
  const gallery=document.getElementById('gallery');
  const empty=document.getElementById('empty');
  const search=document.getElementById('search');
  const period=document.getElementById('period');
  const sort=document.getElementById('sort');
  const countEl=document.getElementById('gallery-count');
  const updatedEl=document.getElementById('gallery-updated');
  const resultCount=document.getElementById('result-count');
  const pageRange=document.getElementById('page-range');
  const loadMoreWrap=document.getElementById('load-more-wrap');
  const loadMore=document.getElementById('load-more');
  const footerCount=document.getElementById('footer-count');
  const viewer=document.getElementById('viewer');
  const viewerFeed=document.getElementById('viewer-feed');
  const viewerPosition=document.getElementById('viewer-position');
  let photos=[];
  let visibleLimit=LOAD_STEP;
  let visibleRows=[];
  let observer=null;
  let mainImageObserver=null;
  let viewerImageObserver=null;
  const fmt=new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'});

  function jakartaDateKey(ts){
    return new Date(ts).toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'});
  }

  function currentJakartaYear(){
    return Number(jakartaDateKey(Date.now()).slice(0,4));
  }

  function createImageObserver(root,rootMargin){
    if(!('IntersectionObserver' in window))return null;
    return new IntersectionObserver(entries=>{
      for(const entry of entries){
        if(!entry.isIntersecting)continue;
        const img=entry.target;
        const src=img.dataset.src;
        if(src){
          img.src=src;
          delete img.dataset.src;
        }
        entry.target.__imageObserver?.unobserve(entry.target);
        delete entry.target.__imageObserver;
      }
    },{root,rootMargin,threshold:.01});
  }

  function queueImage(img,url,{eager=false,observer=null}={}){
    img.decoding='async';
    if(eager||!observer){
      img.loading=eager?'eager':'lazy';
      img.fetchPriority=eager?'high':'low';
      img.src=url;
      return;
    }
    img.loading='lazy';
    img.fetchPriority='low';
    img.dataset.src=url;
    img.__imageObserver=observer;
    observer.observe(img);
  }

  function buildPeriodOptions(){
    const selected=period.value;
    period.querySelectorAll('option[data-history-year]').forEach(option=>option.remove());
    const currentYear=currentJakartaYear();
    const years=[...new Set(photos.map(photo=>Number(jakartaDateKey(photo.createdAt).slice(0,4))).filter(year=>Number.isFinite(year)&&year>1900&&year<currentYear))].sort((a,b)=>b-a);
    for(const year of years){
      const option=document.createElement('option');
      option.value='year:'+year;
      option.textContent=String(year);
      option.dataset.historyYear='1';
      period.appendChild(option);
    }
    if([...period.options].some(option=>option.value===selected))period.value=selected;
  }

  function matchesPeriod(ts,type){
    if(type==='all')return true;
    const dKey=jakartaDateKey(ts);
    const nKey=jakartaDateKey(Date.now());
    if(type==='today')return dKey===nKey;
    const dp=dKey.split('-'),np=nKey.split('-');
    if(type==='month')return dp[0]===np[0]&&dp[1]===np[1];
    if(type==='year')return dp[0]===np[0];
    if(type.startsWith('year:'))return dp[0]===type.slice(5);
    return true;
  }

  function filteredRows(){
    const q=search.value.trim().toLowerCase();
    const rows=photos.filter(p=>matchesPeriod(p.createdAt,period.value)&&(!q||
      String(p.caption||'').toLowerCase().includes(q)||
      String(p.uploaderName||'').toLowerCase().includes(q)||
      String(p.id||'').toLowerCase().includes(q)||
      String(p.originGroupName||'').toLowerCase().includes(q)
    ));
    rows.sort((a,b)=>{
      const diff=Number(a.createdAt||0)-Number(b.createdAt||0);
      if(diff!==0)return sort.value==='oldest'?diff:-diff;
      const aNo=Number(a.nomor||0),bNo=Number(b.nomor||0);
      return sort.value==='oldest'?aNo-bNo:bNo-aNo;
    });
    return rows;
  }

  function cardFor(p,index){
    const b=document.createElement('button');
    b.className='card';
    b.type='button';
    const img=document.createElement('img');
    img.alt=p.caption||p.id;
    queueImage(img,p.publicUrl,{eager:index<2,observer:mainImageObserver});
    const badge=document.createElement('span');
    badge.className='badge';
    badge.textContent=p.id;
    b.append(img,badge);
    b.addEventListener('click',()=>openViewer(p));
    return b;
  }

  function render(){
    const rows=filteredRows();
    const visible=rows.slice(0,visibleLimit);
    visibleRows=visible.slice();
    if(mainImageObserver)mainImageObserver.disconnect();
    mainImageObserver=createImageObserver(null,'520px 0px');
    gallery.innerHTML='';
    const groups=new Map();
    for(const p of visible){
      const key=p.batchId||p.id;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(p);
    }
    let imageIndex=0;
    for(const batch of groups.values()){
      const first=batch[0];
      const section=document.createElement('section');
      section.className='batch-section';
      const head=document.createElement('div');
      head.className='batch-head';
      const title=document.createElement('h2');
      title.textContent=first.caption||'Tanpa keterangan';
      const info=document.createElement('span');
      info.textContent=batch.length+' foto ditampilkan · '+fmt.format(new Date(first.createdAt));
      head.append(title,info);
      const grid=document.createElement('div');
      grid.className='batch-grid';
      for(const p of batch)grid.appendChild(cardFor(p,imageIndex++));
      section.append(head,grid);
      gallery.appendChild(section);
    }
    empty.hidden=rows.length!==0;
    resultCount.textContent=rows.length+' foto';
    pageRange.textContent=rows.length?'Menampilkan '+visible.length+' dari '+rows.length:'';
    footerCount.textContent=rows.length?visible.length+' / '+rows.length+' foto':'';
    loadMoreWrap.hidden=visible.length>=rows.length;
    loadMore.textContent=visible.length<rows.length?'Muat lainnya ('+Math.min(LOAD_STEP,rows.length-visible.length)+')':'Muat lainnya';
  }

  function extFor(photo){
    const mime=String(photo.mimeType||'image/jpeg').toLowerCase();
    if(mime.includes('png'))return 'png';
    if(mime.includes('webp'))return 'webp';
    if(mime.includes('heic'))return 'heic';
    if(mime.includes('gif'))return 'gif';
    return 'jpg';
  }

  async function downloadPhoto(photo,button){
    const old=button.textContent;
    button.disabled=true;
    button.textContent='Menyiapkan…';
    try{
      const response=await fetch(photo.publicUrl,{mode:'cors',cache:'no-store'});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const blob=await response.blob();
      const objectUrl=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=objectUrl;
      a.download=(photo.id||'FOTO')+'.'+extFor(photo);
      a.style.display='none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(objectUrl),1500);
      button.textContent='✓ Tersimpan';
      setTimeout(()=>{button.textContent=old;button.disabled=false},1200);
      return;
    }catch(err){
      console.error('[Galeri Download]',err);
      button.disabled=false;
      button.textContent='Download gagal';
      setTimeout(()=>{button.textContent=old},1800);
    }
  }

  function viewerItem(photo,index,selectedId){
    const item=document.createElement('section');
    item.className='viewer-item';
    item.dataset.photoId=photo.id;
    item.dataset.index=String(index);

    const media=document.createElement('div');
    media.className='viewer-media';
    const img=document.createElement('img');
    img.alt=photo.caption||photo.id;
    queueImage(img,photo.publicUrl,{eager:photo.id===selectedId,observer:viewerImageObserver});
    media.appendChild(img);

    const info=document.createElement('div');
    info.className='viewer-info';
    const copy=document.createElement('div');
    copy.className='viewer-copy';
    const caption=document.createElement('strong');
    caption.textContent=photo.caption||'Tanpa keterangan';
    const identity=document.createElement('span');
    identity.className='viewer-photo-id';
    identity.textContent=photo.id;
    const date=document.createElement('span');
    date.textContent=fmt.format(new Date(photo.createdAt))+(photo.uploaderName?' · '+photo.uploaderName:'');
    const origin=document.createElement('span');
    origin.textContent=photo.originGroupName?'Sumber: '+photo.originGroupName:'';
    copy.append(caption,identity,date);
    if(origin.textContent)copy.appendChild(origin);

    const actions=document.createElement('div');
    actions.className='viewer-actions';
    const original=document.createElement('a');
    original.className='action secondary';
    original.href=photo.publicUrl;
    original.target='_blank';
    original.rel='noopener';
    original.textContent='Lihat asli';
    const download=document.createElement('button');
    download.className='action primary';
    download.type='button';
    download.textContent='↓ Download';
    download.addEventListener('click',()=>downloadPhoto(photo,download));
    actions.append(original,download);
    info.append(copy,actions);
    item.append(media,info);
    return item;
  }

  function openViewer(photo){
    const rows=visibleRows.length?visibleRows:[photo];
    if(viewerImageObserver)viewerImageObserver.disconnect();
    viewerFeed.innerHTML='';
    viewerImageObserver=createImageObserver(viewerFeed,'110% 0px');
    rows.forEach((p,i)=>viewerFeed.appendChild(viewerItem(p,i,photo.id)));
    viewer.showModal();

    if(observer)observer.disconnect();
    observer=new IntersectionObserver(entries=>{
      let best=null;
      for(const entry of entries){
        if(!entry.isIntersecting)continue;
        if(!best||entry.intersectionRatio>best.intersectionRatio)best=entry;
      }
      if(best){
        const idx=Number(best.target.dataset.index||0);
        const p=rows[idx];
        viewerPosition.textContent=(p?p.id:'Foto')+' · '+(idx+1)+' dari '+rows.length;
      }
    },{root:viewerFeed,threshold:[.45,.6,.75]});
    viewerFeed.querySelectorAll('.viewer-item').forEach(el=>observer.observe(el));

    requestAnimationFrame(()=>{
      const target=viewerFeed.querySelector('[data-photo-id="'+CSS.escape(photo.id)+'"]');
      if(target)target.scrollIntoView({block:'start'});
    });
  }

  function resetAndRender(){
    visibleLimit=LOAD_STEP;
    render();
  }

  document.getElementById('close-viewer').onclick=()=>viewer.close();
  viewer.addEventListener('close',()=>{
    if(observer){observer.disconnect();observer=null}
    if(viewerImageObserver){viewerImageObserver.disconnect();viewerImageObserver=null}
    viewerFeed.innerHTML='';
    viewerPosition.textContent='';
  });
  loadMore.onclick=()=>{visibleLimit+=LOAD_STEP;render()};
  search.addEventListener('input',resetAndRender);
  period.addEventListener('change',resetAndRender);
  sort.addEventListener('change',resetAndRender);

  function loadLiveManifest(){
    if(!liveManifest)return Promise.reject(new Error('Manifest live belum tersedia'));
    return new Promise((resolve,reject)=>{
      const previous=globalThis.__PROXYZ_GALLERY_LIVE__;
      try{delete globalThis.__PROXYZ_GALLERY_LIVE__}catch{}
      const script=document.createElement('script');
      const joiner=liveManifest.includes('?')?'&':'?';
      script.src=liveManifest+joiner+'v='+Date.now();
      script.async=true;
      script.onload=()=>{
        const data=globalThis.__PROXYZ_GALLERY_LIVE__;
        script.remove();
        if(data&&String(data.token||'')===String(token||'')){
          resolve(data);
        }else{
          if(previous!==undefined)globalThis.__PROXYZ_GALLERY_LIVE__=previous;
          reject(new Error('Manifest live tidak cocok'));
        }
      };
      script.onerror=()=>{
        script.remove();
        if(previous!==undefined)globalThis.__PROXYZ_GALLERY_LIVE__=previous;
        reject(new Error('Manifest live gagal dimuat'));
      };
      document.head.appendChild(script);
    });
  }

  async function loadGalleryData(){
    try{
      return await loadLiveManifest();
    }catch(liveError){
      const r=await fetch('../../data/galeri/'+encodeURIComponent(token)+'.json?v='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error('Data galeri tidak ditemukan');
      return await r.json();
    }
  }

  loadGalleryData()
    .then(data=>{
      photos=Array.isArray(data.photos)?data.photos:[];
      if(titleEl&&data.galleryName)titleEl.textContent=data.galleryName;
      countEl.textContent=photos.length+' foto';
      updatedEl.textContent='diperbarui '+fmt.format(new Date(data.updatedAt||Date.now()));
      buildPeriodOptions();
      render();
    })
    .catch(err=>{
      countEl.textContent='Galeri belum tersedia';
      updatedEl.textContent='';
      resultCount.textContent='';
      pageRange.textContent='';
      footerCount.textContent='';
      loadMoreWrap.hidden=true;
      empty.textContent=err.message;
      empty.hidden=false;
    });
})();