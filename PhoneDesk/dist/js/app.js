'use strict';
// Cấu hình API sản phẩm dùng chung với trang bán hàng.
const API_URL = 'https://6ac89057fd7c536b1bd94d2d.mockapi.io/products';
const normalizeType = value => String(value ?? '').trim().toLowerCase();
const normalizeName = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
const safeImageUrl = value => {
  try { const url = new URL(String(value).trim()); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat('vi-VN', {style:'currency', currency:'VND', maximumFractionDigits:2}).format(Number(value)) : 'Chưa có giá';
class Product {
  constructor(data) {
    if (data.id != null) this.id = String(data.id);
    this.name = String(data.name ?? '').trim();
    this.price = Number(data.price);
    this.screen = String(data.screen ?? '').trim();
    this.backCamera = String(data.backCamera ?? data.blackCamera ?? '').trim();
    this.frontCamera = String(data.frontCamera ?? '').trim();
    this.img = String(data.img ?? '').trim();
    this.desc = String(data.desc ?? '').trim();
    this.type = normalizeType(data.type);
  }
}
class ProductService {
  constructor(client) { this.client = client; }
  async list() {
    try {
      const {data} = await this.client.get(API_URL);
      if (!Array.isArray(data)) throw new Error('API trả về dữ liệu không đúng định dạng danh sách.');
      return data.map(item => new Product(item));
    } catch (error) {
      // MockAPI có thể trả 404 cho một collection rỗng.
      if (error.response?.status === 404 && /not found/i.test(String(error.response?.data))) return [];
      throw error;
    }
  }
  async get(id) { const {data} = await this.client.get(`${API_URL}/${encodeURIComponent(id)}`); return new Product(data); }
  async create(product) { const {id, ...payload} = product; const {data} = await this.client.post(API_URL, payload); return new Product(data); }
  async update(id, product) { const {id: ignored, ...payload} = product; const {data} = await this.client.put(`${API_URL}/${encodeURIComponent(id)}`, payload); return new Product(data); }
  async remove(id) { await this.client.delete(`${API_URL}/${encodeURIComponent(id)}`); }
}
function validateProduct(data) {
  const errors = {};
  for (const field of ['name','screen','backCamera','frontCamera','img','desc']) {
    if (!String(data[field] ?? '').trim()) errors[field] = 'Vui lòng nhập thông tin này.';
  }
  const rawPrice = String(data.price ?? '').trim();
  if (!rawPrice || !Number.isFinite(Number(rawPrice)) || Number(rawPrice) <= 0) errors.price = 'Giá phải là số lớn hơn 0.';
  if (!['samsung','iphone'].includes(normalizeType(data.type))) errors.type = 'Vui lòng chọn Samsung hoặc iPhone.';
  if (data.img && !safeImageUrl(data.img)) errors.img = 'Nhập đường dẫn ảnh bắt đầu bằng http:// hoặc https://.';
  for (const [field, max] of Object.entries({name:200,screen:300,backCamera:300,frontCamera:300,desc:2000})) {
    if (String(data[field] ?? '').trim().length > max) errors[field] = `Tối đa ${max} ký tự.`;
  }
  return errors;
}
function selectProducts(products, query = '', type = '', sort = '') {
  const keyword = normalizeName(query);
  const result = products.filter(product => (!keyword || normalizeName(product.name).includes(keyword)) && (!type || normalizeType(product.type) === normalizeType(type)));
  if (sort === 'asc') result.sort((a,b) => Number(a.price) - Number(b.price));
  if (sort === 'desc') result.sort((a,b) => Number(b.price) - Number(a.price));
  return result;
}
function describeError(error, mutation = false) {
  if (error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK') return mutation ? 'Chưa xác nhận được kết quả lưu. Hãy đóng form và làm mới danh sách để kiểm tra trước khi thử lại.' : 'Không thể kết nối dữ liệu. Kiểm tra Internet rồi nhấn Làm mới.';
  if (error.response?.status === 404) return 'Không tìm thấy sản phẩm. Hãy làm mới danh sách.';
  if (error.response?.status === 429) return 'API đang nhận quá nhiều yêu cầu. Vui lòng thử lại sau.';
  return error.response ? `API báo lỗi ${error.response.status}. Vui lòng thử lại sau.` : (error.message || 'Có lỗi xảy ra. Vui lòng thử lại.');
}
// Export để kiểm tra logic bằng Node.js mà không thay đổi dữ liệu API thật.
if (typeof module !== 'undefined' && module.exports) module.exports = {Product,ProductService,validateProduct,selectProducts,escapeHtml,safeImageUrl,normalizeType,describeError,API_URL};
if (typeof document !== 'undefined') initializeApp();
function initializeApp() {
  const $ = id => document.getElementById(id);
  const fields = ['name','price','screen','backCamera','frontCamera','img','desc','type'];
  const state = {products:[],loading:false,editId:null,deleteId:null,saving:false,deleting:false,editing:false};
  const dialog = $('product-dialog');
  const deleteDialog = $('delete-dialog');
  let toastTimer;
  let service;
  const fallbackImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 70"><rect width="60" height="70" fill="#f7f9f4"/><rect x="20" y="10" width="22" height="48" rx="4" fill="#e7ede2" stroke="#a5b5a0"/><path d="M28 15h6M28 53h6" stroke="#a5b5a0"/></svg>');
  const editIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6zM14 5l5 5"/></svg>';
  const deleteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>';
  function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => {$('toast').hidden = true;},4500); }
  function connection(online) { $('connection-dot').className = `dot ${online ? 'online' : 'offline'}`; $('connection-text').textContent = online ? 'Đã kết nối dữ liệu' : 'Chưa kết nối được'; }
  function banner(id, message = '') { $(id).textContent = message; $(id).hidden = !message; }
  function updateStats() {
    $('stat-total').textContent = state.products.length;
    $('stat-samsung').textContent = state.products.filter(p => normalizeType(p.type) === 'samsung').length;
    $('stat-iphone').textContent = state.products.filter(p => normalizeType(p.type) === 'iphone').length;
    $('nav-count').textContent = state.products.length;
  }
  function render() {
    updateStats();
    const products = selectProducts(state.products,$('search').value,$('type-filter').value,$('sort').value);
    $('list-count').textContent = products.length;
    $('result-text').textContent = `Hiển thị ${products.length} / ${state.products.length} sản phẩm`;
    if (!products.length) {
      $('product-body').innerHTML = '<tr><td colspan="6" class="state-cell"><strong>' + (state.products.length ? 'Không tìm thấy sản phẩm' : 'Danh mục chưa có sản phẩm') + '</strong>' + (state.products.length ? 'Thử tên khác hoặc thay đổi bộ lọc.' : 'Nhấn “Thêm sản phẩm” để bắt đầu.') + '</td></tr>';
      return;
    }
    $('product-body').innerHTML = products.map((p,index) => `<tr><td class="order">${String(index+1).padStart(2,'0')}</td><td><div class="product-cell"><div class="product-thumb"><img src="${escapeHtml(safeImageUrl(p.img) || fallbackImage)}" alt="${escapeHtml(p.name)}" loading="lazy" referrerpolicy="no-referrer"></div><div><strong>${escapeHtml(p.name)}</strong><small>Mã sản phẩm · ${escapeHtml(p.id)}</small></div></div></td><td><span class="type-badge ${normalizeType(p.type) === 'iphone' ? 'iphone' : ''}">${escapeHtml(normalizeType(p.type) === 'iphone' ? 'iPhone' : normalizeType(p.type) === 'samsung' ? 'Samsung' : p.type || 'Chưa phân loại')}</span></td><td class="price">${money(p.price)}</td><td class="spec-col"><div class="spec"><span>${escapeHtml(p.screen)}</span><span>Camera sau: ${escapeHtml(p.backCamera)}</span></div></td><td class="col-actions"><div class="actions"><button type="button" class="icon-button" data-action="edit" data-id="${escapeHtml(p.id)}" title="Sửa sản phẩm" aria-label="Sửa ${escapeHtml(p.name)}">${editIcon}</button><button type="button" class="icon-button delete" data-action="delete" data-id="${escapeHtml(p.id)}" title="Xóa sản phẩm" aria-label="Xóa ${escapeHtml(p.name)}">${deleteIcon}</button></div></td></tr>`).join('');
    document.querySelectorAll('#product-body img').forEach(img => { img.addEventListener('error', () => {img.src = fallbackImage;}, {once:true}); });
  }
  async function load() {
    if (state.loading || state.saving || state.deleting) return;
    if (!service) { banner('load-error','Không tải được Axios. Hãy kiểm tra file vendor/axios.min.js rồi mở lại trang.'); connection(false); return; }
    state.loading = true; $('refresh').disabled = true; $('refresh').innerHTML = '<span class="loader"></span> Đang tải'; banner('load-error');
    try { state.products = await service.list(); render(); connection(true); $('last-updated').textContent = `Cập nhật ${new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}`; }
    catch(error) { banner('load-error',describeError(error)); connection(false); if (!state.products.length) {$('product-body').innerHTML = '<tr><td colspan="6" class="state-cell"><strong>Chưa tải được danh sách</strong>Nhấn “Làm mới” để thử lại.</td></tr>'; $('result-text').textContent = 'Không tải được dữ liệu';} }
    finally { state.loading = false; $('refresh').disabled = false; $('refresh').innerHTML = '<span aria-hidden="true">↻</span> Làm mới'; }
  }
  function resetErrors() { fields.forEach(field => {$(`error-${field}`).textContent = ''; $(`field-${field}`).removeAttribute('aria-invalid'); $(`field-${field}`).removeAttribute('aria-describedby');}); banner('form-error'); }
  function previewImage() { const url = safeImageUrl($('field-img').value); $('image-preview').hidden = true; $('image-placeholder').hidden = false; if (url) {$('image-preview').src = url;} else {$('image-preview').removeAttribute('src');} }
  $('image-preview').addEventListener('load', () => {$('image-preview').hidden = false; $('image-placeholder').hidden = true;});
  $('image-preview').addEventListener('error', () => {$('image-preview').hidden = true; $('image-placeholder').hidden = false;});
  function openForm(product = null) {
    if (state.loading || state.saving || state.deleting || state.editing) {toast('Vui lòng chờ thao tác hiện tại hoàn tất.'); return;}
    $('product-form').reset(); resetErrors(); state.editId = product?.id ?? null;
    $('dialog-title').textContent = product ? 'Chỉnh sửa sản phẩm' : 'Thêm sản phẩm';
    $('save-product').textContent = product ? 'Lưu thay đổi' : 'Thêm sản phẩm';
    fields.forEach(field => {$(`field-${field}`).value = product?.[field] ?? '';});
    previewImage(); dialog.showModal(); $('field-name').focus();
  }
  async function openEdit(id, button) {
    if (state.loading || state.saving || state.deleting || state.editing) return;
    state.editing = true; button.disabled = true;
    try { const product = await service.get(id); state.editing = false; openForm(product); }
    catch(error) { toast(describeError(error)); }
    finally { state.editing = false; button.disabled = false; }
  }
  function lockForm(locked) { state.saving = locked; fields.forEach(field => {$(`field-${field}`).disabled = locked;}); $('save-product').disabled = locked; dialog.querySelectorAll('.close-dialog').forEach(button => {button.disabled = locked;}); $('save-product').textContent = locked ? 'Đang lưu…' : state.editId ? 'Lưu thay đổi' : 'Thêm sản phẩm'; }
  $('product-form').addEventListener('submit', async event => {
    event.preventDefault(); if (state.saving || !service) return;
    resetErrors(); const data = Object.fromEntries(fields.map(field => [field,$(`field-${field}`).value.trim()]));
    const errors = validateProduct(data);
    if (Object.keys(errors).length) { for (const [field,message] of Object.entries(errors)) {$(`error-${field}`).textContent = message; $(`field-${field}`).setAttribute('aria-invalid','true'); $(`field-${field}`).setAttribute('aria-describedby',`error-${field}`);} $(`field-${Object.keys(errors)[0]}`).focus(); return; }
    const id = state.editId; lockForm(true);
    try {
      const saved = id == null ? await service.create(new Product(data)) : await service.update(id,new Product(data));
      const index = state.products.findIndex(p => String(p.id) === String(saved.id));
      if (index < 0) state.products.push(saved); else state.products[index] = saved;
      render(); connection(true); dialog.close(); banner('load-error');
      $('last-updated').textContent = `Cập nhật ${new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}`;
      toast(id == null ? 'Đã thêm sản phẩm thành công.' : 'Đã cập nhật sản phẩm thành công.');
    } catch(error) { banner('form-error',describeError(error,true)); }
    finally { lockForm(false); }
  });
  $('product-body').addEventListener('click',event => {
    const button = event.target.closest('button[data-action]'); if (!button || state.loading || state.saving || state.deleting || state.editing) return;
    const id = button.dataset.id;
    if (button.dataset.action === 'edit') {openEdit(id,button);return;}
    const product = state.products.find(p => String(p.id) === String(id)); if (!product) return;
    state.deleteId = id; $('delete-name').textContent = product.name; banner('delete-error'); deleteDialog.showModal(); $('cancel-delete').focus();
  });
  $('confirm-delete').addEventListener('click',async () => {
    if (state.deleting || state.deleteId == null) return;
    state.deleting = true; $('confirm-delete').disabled = true; $('cancel-delete').disabled = true; $('confirm-delete').textContent = 'Đang xóa…'; banner('delete-error');
    try { await service.remove(state.deleteId); state.products = state.products.filter(p => String(p.id) !== String(state.deleteId)); render(); connection(true); deleteDialog.close(); toast('Đã xóa sản phẩm thành công.'); }
    catch(error) { banner('delete-error',describeError(error,true)); }
    finally { state.deleting = false; $('confirm-delete').disabled = false; $('cancel-delete').disabled = false; $('confirm-delete').textContent = 'Xóa sản phẩm'; }
  });
  $('cancel-delete').addEventListener('click',() => {if (!state.deleting) deleteDialog.close();});
  dialog.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click',() => {if (!state.saving) dialog.close();}));
  dialog.addEventListener('cancel',event => {if (state.saving) event.preventDefault();});
  deleteDialog.addEventListener('cancel',event => {if (state.deleting) event.preventDefault();});
  $('add-product').addEventListener('click',() => openForm()); $('refresh').addEventListener('click',load);
  $('search').addEventListener('input',() => {if (!state.loading) render();});
  $('type-filter').addEventListener('change',() => {if (!state.loading) render();}); $('sort').addEventListener('change',() => {if (!state.loading) render();});
  $('field-img').addEventListener('change',previewImage);
  if (typeof axios !== 'undefined') service = new ProductService(axios.create({timeout:20000,headers:{'Content-Type':'application/json'}}));
  load();
}
