/* ========================================
   MINIMALIST PORTFOLIO - MAIN SCRIPT
   ======================================== */

let portfolioData = null;
let categoriesData = null;
let manifestData = null;

// Initialize portfolio data on page load
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([
    loadManifestData(),
    loadPortfolioData(),
    loadCategoriesData(),
  ]);

  applyManifestContent();

  if (document.getElementById('portfolio-gallery')) {
    renderPortfolio();
    warmImageCache(getPortfolioWarmImages());
  }

  if (document.getElementById('category-grid')) {
    renderCategoryBrowse();
    warmImageCache(getCategoryWarmImages());
  }
});

/* ========================================
   IMAGE SOURCE RESOLVER
   Handles legacy local filenames AND
   ImgBB URLs with thumb/medium variants.
   ======================================== */
function resolveUrl(value) {
  if (!value) return '';
  return value.startsWith('http') ? value : `./images/${value}`;
}

function imgSrc(item, size = 'full') {
  if (!item) return '';

  // Prefer thumb/medium when requested and available.
  if (size === 'thumb' && item.thumb) return resolveUrl(item.thumb);
  if (size === 'medium' && item.medium) return resolveUrl(item.medium);

  // Fall back to the full URL.
  return resolveUrl(item.filename || item.url || '');
}

function imgSrcset(item) {
  if (!item) return '';

  const sources = [];
  if (item.thumb) sources.push(`${resolveUrl(item.thumb)} 300w`);
  if (item.medium) sources.push(`${resolveUrl(item.medium)} 800w`);

  const full = item.filename || item.url;
  if (full) sources.push(`${resolveUrl(full)} 1600w`);

  return sources.join(', ');
}

/* ========================================
   IMAGE LOAD STATE
   Adds a `.loaded` class to the container
   once the image has actually rendered.
   ======================================== */
function markImageLoaded(container) {
  if (!container) return;
  const img = container.querySelector('img');
  if (!img) return;

  const done = () => container.classList.add('loaded');

  // Image already decoded (from cache) — mark immediately.
  if (img.complete && img.naturalWidth > 0) {
    done();
    return;
  }

  img.addEventListener('load', done, { once: true });
  img.addEventListener('error', done, { once: true });
}

function warmImageCache(filenames) {
  const uniqueFiles = [...new Set(filenames)].filter(Boolean);
  if (!uniqueFiles.length) return;

  const warm = () => {
    uniqueFiles.forEach(value => {
      const src = value.startsWith('http') ? value : `./images/${value}`;
      const image = new Image();
      image.decoding = 'async';
      image.src = src;
    });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(warm, { timeout: 2000 });
  } else {
    window.setTimeout(warm, 500);
  }
}

function getPortfolioWarmImages() {
  const favorites = portfolioData?.favorites ?? [];
  return favorites
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(item => item.filename || item.url);
}

function getCategoryWarmImages() {
  const categories = categoriesData?.categories ?? [];
  const images = categoriesData?.images ?? [];
  return [
    ...categories.map(c => c.thumbnail),
    ...images.map(i => i.filename || i.url),
  ].filter(Boolean);
}

/* ========================================
   MANIFEST / TEXT CONTENT
   ======================================== */
function applyManifestContent() {
  if (!manifestData) return;

  const page = document.body.dataset.page;
  const site = manifestData.site;
  const pages = manifestData.pages;

  const navMap = {
    'index.html': site.nav.home,
    'portfolio.html': site.nav.portfolio,
    'browse.html': site.nav.browse,
    'contact.html': site.nav.contact,
  };

  Object.entries(navMap).forEach(([href, label]) => {
    const link = document.querySelector(`header nav a[href="${href}"]`);
    if (link && label) link.textContent = label;
  });

  document.querySelectorAll('#site-footer').forEach(footer => {
    footer.textContent = site.footer;
  });

  if (page === 'home') {
    document.title = `${site.name} | Portfolio`;
    setText('home-hero-title', pages.home.title);
    setText('home-hero-lead', pages.home.hero.lead);
    setText('home-about-heading', pages.home.about.heading);
    setText('home-background-heading', pages.home.about.backgroundHeading);
    setText('home-background-1', pages.home.about.background[0]);
    setText('home-background-2', pages.home.about.background[1]);
    setText('home-philosophy-heading', pages.home.about.philosophyHeading);
    setText('home-philosophy-1', pages.home.about.philosophy[0]);
    setText('home-philosophy-2', pages.home.about.philosophy[1]);
    setText('home-experience-heading', pages.home.about.experienceHeading);
    setText('home-experience', pages.home.about.experience);
    setText('home-explore-heading', pages.home.about.exploreHeading);
    setText('home-explore', pages.home.about.explore);
    setText('home-portfolio-link', pages.home.about.actions.portfolio);
    setText('home-browse-link', pages.home.about.actions.browse);
    setText('home-contact-link', pages.home.about.actions.contact);
  }

  if (page === 'about') {
    document.title = `About Me | ${site.name}`;
    setText('about-title', pages.about.title);
    setText('about-background-heading', pages.about.backgroundHeading);
    setText('about-background-1', pages.about.background[0]);
    setText('about-background-2', pages.about.background[1]);
    setText('about-philosophy-heading', pages.about.philosophyHeading);
    setText('about-philosophy-1', pages.about.philosophy[0]);
    setText('about-philosophy-2', pages.about.philosophy[1]);
    setText('about-experience-heading', pages.about.experienceHeading);
    setText('about-experience', pages.about.experience);
    setText('about-portfolio-link', pages.about.actions.portfolio);
    setText('about-browse-link', pages.about.actions.browse);
  }

  if (page === 'portfolio') {
    document.title = `Portfolio | ${site.name}`;
    setText('portfolio-title', pages.portfolio.title);
    setText('portfolio-description', pages.portfolio.description);
  }

  if (page === 'browse') {
    document.title = `Browse | ${site.name}`;
    setText('browse-title', pages.browse.title);
    setText('browse-description', pages.browse.description);
  }

  if (page === 'contact') {
    document.title = `Contact | ${site.name}`;
    setText('contact-title', pages.contact.title);
    setText('contact-description', pages.contact.description);
    setText('contact-name-label', pages.contact.form.name);
    setText('contact-email-label', pages.contact.form.email);
    setText('contact-message-label', pages.contact.form.message);
    setText('contact-submit', pages.contact.form.submit);
    setText('contact-direct-heading', pages.contact.direct.heading);
    setHTML('contact-email-line',
      `${pages.contact.direct.emailLabel} <a href="mailto:${pages.contact.direct.email}">${pages.contact.direct.email}</a>`);
    setText('contact-phone-line',
      `${pages.contact.direct.phoneLabel} ${pages.contact.direct.phone}`);
    setHTML('contact-instagram-line',
      `${pages.contact.direct.instagramLabel} <a href="https://instagram.com" target="_blank">${pages.contact.direct.instagram}</a>`);
  }
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element && typeof value === 'string') element.textContent = value;
}

function setHTML(id, value) {
  const element = document.getElementById(id);
  if (element && typeof value === 'string') element.innerHTML = value;
}

/* ========================================
   DATA LOADERS
   ======================================== */
// Auto-detect backend URL: localhost uses :8000, production uses same origin.
const API_BASE =
  location.port === "5500" || location.port === "3000"
    ? `${location.protocol}//${location.hostname}:8000`
    : "";

async function loadManifestData() {
  try {
    const response = await fetch("./data/manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load manifest data");
    manifestData = await response.json();
  } catch (error) {
    console.error("Error loading manifest data:", error);
  }
}

async function loadPortfolioData() {
  try {
    const response = await fetch(`${API_BASE}/api/data/portfolio`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Failed to load portfolio data");
    portfolioData = await response.json();
  } catch (error) {
    console.error("Error loading portfolio data:", error);
  }
}

async function loadCategoriesData() {
  try {
    const response = await fetch(`${API_BASE}/api/data/categories`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Failed to load categories data");
    categoriesData = await response.json();
  } catch (error) {
    console.error("Error loading categories data:", error);
  }
}

/* ========================================
   GALLERY RENDERING
   ======================================== */

function renderPortfolio() {
  if (!portfolioData) return;

  const gallery = document.getElementById('portfolio-gallery');
  gallery.innerHTML = '';

  const favorites = [...portfolioData.favorites].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );

  favorites.forEach(item => {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    const eager = (item.order ?? 99) <= 3;
    div.innerHTML = `
      <span class="img-loader" aria-hidden="true"></span>
      <img src="${imgSrc(item, 'thumb')}"
           srcset="${imgSrcset(item)}"
           sizes="(max-width: 600px) 100vw, (max-width: 1024px) 50vw, 300px"
           alt="artwork" data-id="${item.id}"
           ${eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'}
           decoding="async">
    `;
    div.addEventListener('click', () =>
      openDetailView(item, getArtworkDescription(item.id))
    );
    gallery.appendChild(div);
    markImageLoaded(div);
  });
}

function renderCategoryBrowse() {
  if (!categoriesData) return;

  const categoryGrid = document.getElementById('category-grid');
  const imageGallery = document.getElementById('browse-gallery');

  categoryGrid.innerHTML = '';
  imageGallery.hidden = true;
  imageGallery.innerHTML = '';

  const sortedCategories = [...categoriesData.categories].sort(
    (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
  );

  sortedCategories.forEach((category, index) => {
    const card = document.createElement('div');
    card.className = 'category-card';
    const eager = index < 4;
    const thumbSrc = resolveUrl(category.thumbnail || '');
    card.innerHTML = `
      <div class="category-card-image">
        <span class="img-loader" aria-hidden="true"></span>
        <img src="${thumbSrc}" alt="${category.name}"
             ${eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'}
             decoding="async">
      </div>
      <div class="category-card-title">${category.name}</div>
    `;
    card.addEventListener('click', () => {
      document.querySelectorAll('.category-card').forEach(btn => btn.classList.remove('active'));
      card.classList.add('active');
      displayImagesByCategory(category.id);
      categoryGrid.innerHTML = '';
      categoryGrid.style.display = 'none';
      imageGallery.hidden = false;
    });
    categoryGrid.appendChild(card);
    markImageLoaded(card.querySelector('.category-card-image'));
  });
}

function displayImagesByCategory(categoryId) {
  if (!categoriesData) return;

  const gallery = document.getElementById('browse-gallery');
  gallery.innerHTML = '';

  let images = categoriesData.images || [];
  if (categoryId) images = images.filter(img => img.category === categoryId);

  images.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'gallery-item';
    const eager = !categoryId && index < 4;
    div.innerHTML = `
      <span class="img-loader" aria-hidden="true"></span>
      <img src="${imgSrc(item, 'thumb')}"
           srcset="${imgSrcset(item)}"
           sizes="(max-width: 600px) 100vw, (max-width: 1024px) 50vw, 300px"
           alt="artwork" data-id="${item.id}"
           ${eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'}
           decoding="async">
    `;
    div.addEventListener('click', () =>
      openDetailView(item, getArtworkDescription(item.id))
    );
    gallery.appendChild(div);
    markImageLoaded(div);
  });
}

/* ========================================
   DETAILS & DESCRIPTION
   ======================================== */

function getArtworkDescription(imageId) {
  const portfolioMatch = portfolioData?.favorites?.find(item => item.id === imageId);
  if (portfolioMatch?.description) return portfolioMatch.description;

  const categoryMatch = categoriesData?.images?.find(item => item.id === imageId);
  if (categoryMatch?.description) return categoryMatch.description;

  return '';
}

function getTitleFromDescription(description) {
  if (!description) return 'Untitled';
  const match = description.match(/^([^,.]+)/);
  return match ? match[1].trim() : 'Untitled';
}

function openDetailView(item, description) {
  const title = getTitleFromDescription(description);
  const overlay = document.createElement('div');
  overlay.className = 'detail-overlay';
  overlay.innerHTML = `
    <div class="detail-content">
      <button class="detail-close" aria-label="Close">&times;</button>
      <div class="detail-image-wrapper">
        <span class="img-loader" aria-hidden="true"></span>
        <img src="${imgSrc(item)}"
             srcset="${imgSrcset(item)}"
             sizes="(max-width: 1024px) 100vw, 50vw"
             alt="${title}"
             loading="eager" fetchpriority="high" decoding="async">
      </div>
      <div class="detail-text">
        <h2>${title}</h2>
        <p>${description}</p>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  markImageLoaded(overlay.querySelector('.detail-image-wrapper'));

  overlay.querySelector('.detail-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const handleEsc = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);
}

/* ========================================
   CONTACT FORM
   ======================================== */

document.addEventListener('DOMContentLoaded', () => {
  const contactForm = document.getElementById('contact-form');
  if (!contactForm) return;

  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = document.getElementById('name').value.trim();
    const email = document.getElementById('email').value.trim();
    const message = document.getElementById('message').value.trim();

    if (!name || !email || !message) {
      alert('Please fill in all fields.');
      return;
    }

    const subject = encodeURIComponent('New Portfolio Inquiry');
    const body = encodeURIComponent(`From: ${name} (${email})\n\nMessage:\n${message}`);
    window.location.href = `mailto:contact@example.com?subject=${subject}&body=${body}`;
  });
});