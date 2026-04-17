import './style.css'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger);

document.addEventListener("DOMContentLoaded", () => {
  // 1. Custom Cursor Functionality
  const cursor = document.querySelector('.cursor');
  const cursorFollower = document.querySelector('.cursor-follower');
  const links = document.querySelectorAll('a, button, .tag, .elegant-input');

  document.addEventListener('mousemove', (e) => {
    gsap.to(cursor, { x: e.clientX, y: e.clientY, duration: 0 });
    gsap.to(cursorFollower, { x: e.clientX, y: e.clientY, duration: 0.1 });
  });

  links.forEach(link => {
    link.addEventListener('mouseenter', () => {
      gsap.to(cursorFollower, { scale: 1.5, borderColor: 'rgba(217, 70, 239, 0.8)', duration: 0.3 });
      gsap.to(cursor, { scale: 0.5, backgroundColor: '#d946ef', duration: 0.3 });
    });
    link.addEventListener('mouseleave', () => {
      gsap.to(cursorFollower, { scale: 1, borderColor: 'rgba(139, 92, 246, 0.4)', duration: 0.3 });
      gsap.to(cursor, { scale: 1, backgroundColor: '#8b5cf6', duration: 0.3 });
    });
  });

  // Custom Split-Text for Premium Landing Page Animation
  const heading = document.getElementById('heroHeading');
  if (heading) {
    const text = heading.textContent.trim();
    heading.innerHTML = '';
    text.split(' ').forEach(word => {
      const span = document.createElement('span');
      span.className = 'anim-word';
      span.textContent = word + ' ';
      span.style.display = 'inline-block';
      heading.appendChild(span);
    });
  }

  // 2. Smooth Loader Animation
  const loaderTL = gsap.timeline();
  
  // Show words staggered
  loaderTL.to('.loader-text .word', {
    y: 0,
    opacity: 1,
    duration: 0.8,
    stagger: 0.2,
    ease: "power3.out"
  })
  .to('.loader-progress', {
    width: "100%",
    duration: 1,
    ease: "power2.inOut"
  }, "-=0.5")
  .to('.loader', {
    yPercent: -100,
    duration: 1,
    ease: "power4.inOut",
    delay: 0.2
  })
  // 3. Reveal Hero Content
  .from('.navbar', {
    y: -50,
    opacity: 0,
    duration: 0.8,
    ease: "power3.out"
  }, "-=0.5")
  .from('.anim-word', {
    y: 50,
    opacity: 0,
    duration: 0.8,
    stagger: 0.1,
    ease: "back.out(1.7)"
  }, "-=0.6")
  .from('.hero-visual', {
    scale: 0.8,
    opacity: 0,
    duration: 1.2,
    ease: "power3.out"
  }, "-=0.8")
  .fromTo('#heroAutoFade, .hero-cta-group', 
    { y: 30, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.8, stagger: 0.15, ease: "power3.out" }
  );

  // Begin native Premium Typewriter Effect properly sequenced
  loaderTL.call(() => {
    const phrases = ["Gift Recommender", "Perfect Present", "Smart Assistant", "Curated Selection"];
    const typeTarget = document.getElementById('typewriterText');
    if (typeTarget) {
      let isDeleting = false;
      let loopNum = 0;
      let text = '';

      function typeWriter() {
        const i = loopNum % phrases.length;
        const fullText = phrases[i];

        if (isDeleting) {
          text = fullText.substring(0, text.length - 1);
        } else {
          text = fullText.substring(0, text.length + 1);
        }

        typeTarget.textContent = text;
        
        let typeSpeed = isDeleting ? 40 : 80;

        if (!isDeleting && text === fullText) {
          typeSpeed = 2500; // Pause at full word
          isDeleting = true;
        } else if (isDeleting && text === '') {
          isDeleting = false;
          loopNum++;
          typeSpeed = 400; // Pause before typing new word
        }

        setTimeout(typeWriter, typeSpeed);
      }
      typeWriter();
    }
  }, null, "-=0.2");

  // 4. Parallax Hero Elements
  gsap.to('.orb-1', {
    y: 100,
    x: 50,
    scrollTrigger: {
      trigger: '.hero',
      start: "top top",
      end: "bottom top",
      scrub: 1
    }
  });

  gsap.to('.orb-2', {
    y: -80,
    x: -30,
    scrollTrigger: {
      trigger: '.hero',
      start: "top top",
      end: "bottom top",
      scrub: 1.5
    }
  });

  gsap.to('.floating-gift', {
    yPercent: 30,
    scrollTrigger: {
      trigger: '.hero',
      start: "top top",
      end: "bottom top",
      scrub: 2
    }
  });

  // 5. Reveal Form / Recommender Section on Scroll
  gsap.from('.glass-panel', {
    y: 50,
    opacity: 0,
    duration: 1,
    ease: "power3.out",
    scrollTrigger: {
      trigger: '.glass-panel',
      start: "top 85%",
    }
  });

  // Tag Interaction Logic
  const tags = document.querySelectorAll('.tag');
  tags.forEach(tag => {
    tag.addEventListener('click', () => {
      tag.classList.toggle('selected');
    });
  });

  // Generate Interaction Simulation
  const generateBtn = document.getElementById('generateBtn');
  const resultsArea = document.getElementById('resultsArea');
  const btnText = document.querySelector('.btn-text');
  const recipientNameInput = document.getElementById('recipientName');

  generateBtn.addEventListener('click', async () => {
    const name = recipientNameInput.value.trim() || 'someone special';
    const selectedTags = Array.from(document.querySelectorAll('.tag.selected')).map(t => t.textContent);
    
    // Basic loading simulation
    btnText.textContent = "Analyzing " + name + "...";
    generateBtn.style.opacity = 0.8;
    generateBtn.disabled = true;
    resultsArea.innerHTML = ''; // clear old results

    let items; // Declare items here so both try and catch blocks can use it
    
    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (!apiKey || apiKey === 'your_api_key_here') {
        throw new Error("Missing Gemini API Key. Mock data will be used as fallback.");
      }

      const prompt = `You are a premium AI gift recommender. The user is looking for a gift for "${name}". They selected the following tags/interests: "${selectedTags.join(', ')}".\nSuggest 4 to 7 unique, premium gift ideas. Return the response strictly as a JSON array of objects without markdown formatting.\nEach object must have exactly these 4 properties:\n- "title": (string) Gift name.\n- "desc": (string) A short 1-sentence description.\n- "img": (string) Choose ONE image that best fits: "/zen_garden.png", "/candle_mock.png", "/smart_ring_mock.png", "/modern_coffee_mug.png", "/desk_mat_mock.png", "/headphones_mock.png", "/luxury_watch.png".\n- "p": (array of 4 integers) Realistic estimated prices in INR on 4 mock platforms. Example: [12000, 11500, 12500, 11000]. Make them closely clustered.`;

      const maxRetries = 3;
      let attempt = 0;
      let response;

      while (attempt < maxRetries) {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        });

        if (response.ok) break;

        // If the server is overloaded (503) or rate limited (429), retry
        if (response.status === 503 || response.status === 429) {
          attempt++;
          if (attempt >= maxRetries) {
            throw new Error(`API overloaded (${response.status}). Retried ${maxRetries} times. Please try again later.`);
          }
          console.warn(`API error ${response.status}. Retrying in ${attempt * 1.5} seconds...`);
          await new Promise(resolve => setTimeout(resolve, attempt * 1500));
        } else {
          // If it is any other error (like 400 Bad Request, 403 Forbidden), fail immediately
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
      }

      const data = await response.json();
      let responseText = data.candidates[0].content.parts[0].text;
      
      // Clean up potential markdown formatting code blocks
      responseText = responseText.replace(/^\s*```json\s*/gi, '').replace(/\s*```\s*$/gi, '').trim();
      
      items = JSON.parse(responseText);

      // Show results
      resultsArea.classList.remove('hidden');

      // Inject cards
      resultsArea.innerHTML = items.map((item, index) => `
        <div class="result-card zoom-in-hover" style="transition-delay: ${index * 0.1}s" data-index="${index}">
          <img src="${item.img}" alt="${item.title}" class="card-img" />
          <h3 class="result-title">${item.title}</h3>
          <p class="result-desc">${item.desc}</p>
        </div>
      `).join('');

      window.currentMockItems = items;

      // Update newly added elements for cursor interaction
      const newLinks = resultsArea.querySelectorAll('.result-card');
      newLinks.forEach(link => {
        link.addEventListener('mouseenter', () => {
          gsap.to(cursorFollower, { scale: 1.5, borderColor: 'rgba(217, 70, 239, 0.8)', duration: 0.3 });
          gsap.to(cursor, { scale: 0.5, backgroundColor: '#d946ef', duration: 0.3 });
        });
        link.addEventListener('mouseleave', () => {
          gsap.to(cursorFollower, { scale: 1, borderColor: 'rgba(139, 92, 246, 0.4)', duration: 0.3 });
          gsap.to(cursor, { scale: 1, backgroundColor: '#8b5cf6', duration: 0.3 });
        });
      });

      // Animate results
      gsap.from('.result-card', {
        y: 30,
        opacity: 0,
        duration: 0.6,
        stagger: 0.15,
        ease: "power3.out"
      });

    } catch (error) {
      console.warn("API Error or Missing Key, falling back to mock data:", error.message);
      
      // Mock Fallback Data
      items = [
        { title: "Premium Smart Ring", desc: "A sleek, titanium smart ring tracking sleep and fitness discreetly.", img: "/smart_ring_mock.png", p: [19999, 18500, 21000, 19500] },
        { title: "Artisan Zen Garden", desc: "A desk-sized minimalist zen garden to reduce stress at work.", img: "/zen_garden.png", p: [2500, 2400, 2700, 2650] },
        { title: "Luxury Noise-Canceling Headphones", desc: "Unmatched audio quality and serene silence for the daily commute.", img: "/headphones_mock.png", p: [24900, 24500, 25100, 23900] },
        { title: "Temperature Control Smart Mug", desc: "Keeps morning coffee perfectly hot for hours, right on their desk.", img: "/modern_coffee_mug.png", p: [8900, 8500, 9200, 8400] }
      ];

      // Show results
      resultsArea.classList.remove('hidden');

      // Inject cards
      resultsArea.innerHTML = items.map((item, index) => `
        <div class="result-card zoom-in-hover" style="transition-delay: ${index * 0.1}s" data-index="${index}">
          <img src="${item.img}" alt="${item.title}" class="card-img" />
          <h3 class="result-title">${item.title}</h3>
          <p class="result-desc">${item.desc}</p>
        </div>
      `).join('');

      window.currentMockItems = items;
    } finally {
      btnText.textContent = "Generate Ideas";
      generateBtn.style.opacity = 1;
      generateBtn.disabled = false;
    }
  });

  // Features and Timeline Animations
  gsap.from('.feature-card', {
    y: 50,
    opacity: 0,
    duration: 0.8,
    stagger: 0.2,
    ease: "power3.out",
    scrollTrigger: {
      trigger: '.features-section',
      start: "top 80%"
    }
  });

  gsap.from('.timeline-step', {
    y: 50,
    opacity: 0,
    duration: 0.8,
    stagger: 0.3,
    ease: "power3.out",
    scrollTrigger: {
      trigger: '.how-it-works-section',
      start: "top 80%"
    }
  });

  // Modal Interaction Logic
  const modalOverlay = document.getElementById('productModal');
  const closeModalBtn = document.getElementById('closeModal');
  const modalImg = document.getElementById('modalImg');
  const modalTitle = document.getElementById('modalTitle');
  const modalDesc = document.getElementById('modalDesc');
  const priceGraph = document.getElementById('priceGraph');

  closeModalBtn.addEventListener('click', () => {
    modalOverlay.classList.add('hidden');
  });

  // Delegate click for result cards to open modal
  resultsArea.addEventListener('click', (e) => {
    const card = e.target.closest('.result-card');
    if (card && window.currentMockItems) {
      const idx = card.getAttribute('data-index');
      const item = window.currentMockItems[idx];
      
      // Populate modal
      modalImg.src = item.img;
      modalTitle.textContent = item.title;
      modalDesc.textContent = item.desc;
      
      // Render Graph
      const platforms = ["Amazon", "Flipkart", "Myntra", "Meesho"];
      const maxP = Math.max(...item.p);
      
      // Update actual href attributes
      document.querySelector('.platform-btn.amazon').href = `https://www.amazon.in/s?k=${encodeURIComponent(item.title)}`;
      document.querySelector('.platform-btn.flipkart').href = `https://www.flipkart.com/search?q=${encodeURIComponent(item.title)}`;
      document.querySelector('.platform-btn.myntra').href = `https://www.myntra.com/${encodeURIComponent(item.title)}`;
      document.querySelector('.platform-btn.meesho').href = `https://www.meesho.com/search?q=${encodeURIComponent(item.title)}`;
      
      // Make links open in new tab
      document.querySelectorAll('.platform-btn').forEach(btn => btn.target = "_blank");

      priceGraph.innerHTML = item.p.map((price, i) => {
        const percentage = (price / maxP) * 100;
        return `
          <div class="graph-bar-row">
            <div class="bar-label">${platforms[i]}</div>
            <div class="bar-track">
               <div class="bar-fill" style="width: 0%" data-target="${percentage}%"></div>
            </div>
            <div class="bar-price">₹${price.toLocaleString('en-IN')}</div>
          </div>
        `;
      }).join('');

      // Open Modal
      modalOverlay.classList.remove('hidden');

      // Animate bars after a tiny delay
      setTimeout(() => {
        const fills = priceGraph.querySelectorAll('.bar-fill');
        fills.forEach(fill => {
          fill.style.width = fill.getAttribute('data-target');
        });
      }, 100);
    }
  });

  // 3D Cube Interaction Logic
  const cube = document.querySelector('.cube');
  let cubeRotY = 0;
  let targetRotY = 0;
  let targetRotX = -20;
  
  if (cube) {
    document.addEventListener('mousemove', (e) => {
       targetRotY = (e.clientX / window.innerWidth - 0.5) * 180; 
       targetRotX = (e.clientY / window.innerHeight - 0.5) * -180;
    });

    function animateCube() {
       // Smooth interpolation towards target
       cubeRotY += (targetRotY - cubeRotY) * 0.05;
       
       // Continuous spin base addition
       targetRotY += 0.3; 
       
       cube.style.transform = `rotateX(${-20 + targetRotX * 0.15}deg) rotateY(${cubeRotY}deg)`;
       requestAnimationFrame(animateCube);
    }
    animateCube();
  }

});
