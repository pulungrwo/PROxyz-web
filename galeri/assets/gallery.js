(()=>{
  const PAGE_SIZE=24;
  const token=document.body.dataset.galleryToken;
  const gallery=document.getElementById('gallery');
  const empty=document.getElementById('empty');
  const search=document.getElementById('search');
  const period=document.getElementById('period');
  const countEl=document.getElementById('gallery-count');
  const updatedEl=document.getElementById('gallery-updated');
  const resultCount=document.getElementById('result-count');
  const pageRange=document.getElementById('page-range');
  const pagination=document.getElementById('pagination');
  const pagePrev=document.getElementById('page-prev');
  const pageNext=document.getElementById('page-next');
  const pageNumbers=document.getElementById('page-numbers');
  const footerPage=document.getElementById('footer-page');
  const viewer=document.getElementById('viewer');
  const viewerFeed=document.getElementById('viewer-feed');
  const viewerPosition=document.getElementById('viewer-position');
  let photos=[];
  let currentPage=1;
  let visibleRows=[];
  let observer=null;
  let mainImageObserver=null;
  let viewerImageObserver=null;
  const fmt=new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'});

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

  function matchesPeriod(ts,type){
    if(type==='all')return true;
    const d=new Date(ts),n=new Date();
    const dKey=d.toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'});
    const nKey=n.toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'});
    if(type==='today')return dKey===nKey;
    const dp=dKey.split('-'),np=nKey.split('-');
    if(type==='month')return dp[0]===np[0]&&dp[1]===np[1];
    return dp[0]===np[0];
  }

  function filteredRows(){
    const q=search.value.trim().toLowerCase();
    return photos.filter(p=>matchesPeriod(p.createdAt,period.value)&&(!q||
      String(p.caption||'').toLowerCase().includes(q)||
      String(p.uploaderName||'').toLowerCase().includes(q)||
      String(p.id||'').toLowerCase().includes(q)||
      String(p.originGroupName||'').toLowerCase().includes(q)
    ));
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

  function paginationItems(totalPages,page){
    if(totalPages<=5)return Array.from({length:totalPages},(_,i)=>i+1);
    const items=[1];
    if(page>3)items.push('…');
    const from=Math.max(2,page-1),to=Math.min(totalPages-1,page+1);
    for(let i=from;i<=to;i++)items.push(i);
    if(page<totalPages-2)items.push('…');
    items.push(totalPages);
    return items;
  }

  function renderPagination(totalRows,totalPages){
    pagination.hidden=totalPages<=1;
    pagePrev.disabled=currentPage<=1;
    pageNext.disabled=currentPage>=totalPages;
    pageNumbers.innerHTML='';
    for(const item of paginationItems(totalPages,currentPage)){
      if(item==='…'){
        const s=document.createElement('span');
        s.className='page-ellipsis';
        s.textContent='…';
        pageNumbers.appendChild(s);
        continue;
      }
      const b=document.createElement('button');
      b.type='button';
      b.className='page-number'+(item===currentPage?' active':'');
      b.textContent=String(item);
      b.setAttribute('aria-label','Halaman '+item);
      if(item===currentPage)b.setAttribute('aria-current','page');
      b.onclick=()=>goToPage(item);
      pageNumbers.appendChild(b);
    }
    footerPage.textContent=totalPages>0?'Halaman '+currentPage+' / '+totalPages:'';
  }

  function goToPage(page){
    const rows=filteredRows();
    const totalPages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
    currentPage=Math.min(Math.max(1,page),totalPages);
    render({scroll:true});
  }

  function render(options={}){
    const rows=filteredRows();
    const totalPages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
    if(currentPage>totalPages)currentPage=totalPages;
    const start=(currentPage-1)*PAGE_SIZE;
    const visible=rows.slice(start,start+PAGE_SIZE);
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
      info.textContent=batch.length+' foto di halaman ini · '+fmt.format(new Date(first.createdAt));
      head.append(title,info);
      const grid=document.createElement('div');
      grid.className='batch-grid';
      for(const p of batch)grid.appendChild(cardFor(p,imageIndex++));
      section.append(head,grid);
      gallery.appendChild(section);
    }
    empty.hidden=rows.length!==0;
    resultCount.textContent=rows.length+' foto';
    pageRange.textContent=rows.length?((start+1)+'–'+Math.min(start+PAGE_SIZE,rows.length)+' dari '+rows.length):'';
    renderPagination(rows.length,totalPages);
    if(options.scroll)window.scrollTo({top:document.querySelector('.toolbar').offsetTop-12,behavior:'auto'});
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

  document.getElementById('close-viewer').onclick=()=>viewer.close();
  viewer.addEventListener('close',()=>{
    if(observer){observer.disconnect();observer=null}
    if(viewerImageObserver){viewerImageObserver.disconnect();viewerImageObserver=null}
    viewerFeed.innerHTML='';
    viewerPosition.textContent='';
  });
  pagePrev.onclick=()=>goToPage(currentPage-1);
  pageNext.onclick=()=>goToPage(currentPage+1);
  search.addEventListener('input',()=>{currentPage=1;render()});
  period.addEventListener('change',()=>{currentPage=1;render()});

  fetch('../../data/galeri/'+encodeURIComponent(token)+'.json',{cache:'no-store'})
    .then(r=>{if(!r.ok)throw new Error('Data galeri tidak ditemukan');return r.json()})
    .then(data=>{
      photos=Array.isArray(data.photos)?data.photos:[];
      countEl.textContent=photos.length+' foto';
      updatedEl.textContent='diperbarui '+fmt.format(new Date(data.updatedAt||Date.now()));
      render();
    })
    .catch(err=>{
      countEl.textContent='Galeri belum tersedia';
      updatedEl.textContent='';
      resultCount.textContent='';
      pageRange.textContent='';
      empty.textContent=err.message;
      empty.hidden=false;
    });
})();