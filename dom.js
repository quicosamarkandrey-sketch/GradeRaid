// ─────────────────────────────────────────────────────────────────────────────
// SHARED DOM — DOM manipulation utilities used across all modules
//
// Exports: toast(), showModal(), closeModal(), closeModalForce()
//
// DEPENDENCIES: None
//   Requires DOM elements: #toast, #modal-box, #modal-content, #modal-overlay
//   These elements are defined in the HTML shell (index.html).
// ─────────────────────────────────────────────────────────────────────────────

function toast(msg,color='#4edea3'){
  const el=document.getElementById('toast');
  el.style.display='block';el.style.borderColor=color+'55';el.style.boxShadow=`0 0 20px ${color}33`;
  el.innerHTML=msg;clearTimeout(el._t);el._t=setTimeout(()=>el.style.display='none',2800);
}
function showModal(content,size='md'){
  document.getElementById('modal-box').className='modal-box '+size;
  document.getElementById('modal-content').innerHTML=content;
  document.getElementById('modal-overlay').style.display='flex';
}
function closeModal(e){if(!e||e.target===document.getElementById('modal-overlay'))document.getElementById('modal-overlay').style.display='none';}
function closeModalForce(){document.getElementById('modal-overlay').style.display='none';}
