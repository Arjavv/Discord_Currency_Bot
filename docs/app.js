document.addEventListener('DOMContentLoaded', () => {
  
  // ==========================================
  // MOBILE NAVIGATION MENU
  // ==========================================
  const navToggle = document.getElementById('nav-toggle');
  const navMenu = document.getElementById('nav-menu');

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
      navMenu.classList.toggle('active');
      const icon = navToggle.querySelector('i');
      if (navMenu.classList.contains('active')) {
        icon.className = 'fa-solid fa-xmark';
      } else {
        icon.className = 'fa-solid fa-bars';
      }
    });

    // Close menu when clicking links
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        navMenu.classList.remove('active');
        navToggle.querySelector('i').className = 'fa-solid fa-bars';
      });
    });
  }

  // Navbar scrolled class
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  });

  // ==========================================
  // COMMANDS ACCORDION LIST
  // ==========================================
  const commandItems = document.querySelectorAll('.command-item');
  
  commandItems.forEach(item => {
    const trigger = item.querySelector('.command-trigger');
    trigger.addEventListener('click', () => {
      const isActive = item.classList.contains('active');
      
      // Close all other command items
      commandItems.forEach(otherItem => {
        otherItem.classList.remove('active');
      });
      
      // Toggle current item
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });

  // ==========================================
  // COMMANDS FILTERING & SEARCH
  // ==========================================
  const filterTabs = document.querySelectorAll('.filter-tab');
  const searchInput = document.getElementById('command-search');
  
  let currentFilter = 'all';
  let searchQuery = '';

  function filterCommands() {
    commandItems.forEach(item => {
      const category = item.getAttribute('data-category');
      const name = item.querySelector('.command-name').textContent.toLowerCase();
      const desc = item.querySelector('.command-short-desc').textContent.toLowerCase();
      const details = item.querySelector('.command-details').textContent.toLowerCase();
      
      const matchesFilter = currentFilter === 'all' || category === currentFilter;
      const matchesSearch = name.includes(searchQuery) || desc.includes(searchQuery) || details.includes(searchQuery);
      
      if (matchesFilter && matchesSearch) {
        item.style.display = 'block';
      } else {
        item.style.display = 'none';
        item.classList.remove('active'); // Close details if hidden
      }
    });
  }

  // Filter Tabs click
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.getAttribute('data-filter');
      filterCommands();
    });
  });

  // Search Input change
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      filterCommands();
    });
  }

  // ==========================================
  // EARNINGS SIMULATOR CALCULATOR
  // ==========================================
  const checkinsInput = document.getElementById('checkins-input');
  const messagesInput = document.getElementById('messages-input');
  const casinoInput = document.getElementById('casino-bet');

  const checkinsVal = document.getElementById('checkins-val');
  const messagesVal = document.getElementById('messages-val');
  const casinoVal = document.getElementById('casino-val');

  const weeklySouls = document.getElementById('weekly-souls');
  const monthlySouls = document.getElementById('monthly-souls');
  const progressBar = document.getElementById('calc-progress-bar');
  const progressText = document.getElementById('target-progress-text');

  function calculateEarnings() {
    const checkins = parseInt(checkinsInput.value, 10);
    const messages = parseInt(messagesInput.value, 10);
    const casinoLuck = parseInt(casinoInput.value, 10);

    // Update slider UI displays
    checkinsVal.textContent = checkins;
    messagesVal.textContent = messages;
    casinoVal.textContent = (casinoLuck >= 0 ? '+' : '') + casinoLuck;

    // 1. Calculate checkin earnings per week (20 Souls per claim)
    const checkinWeekly = checkins * 20;

    // 2. Calculate messaging earnings:
    // - Awards 10 Souls per 100 messages
    // - Daily Cap is 20 Souls (equivalent to 200 messages)
    const messageDailySouls = Math.min(20, Math.floor(messages / 100) * 10);
    const messageWeekly = messageDailySouls * 7;

    // 3. Weekly totals
    const totalWeekly = checkinWeekly + messageWeekly + casinoLuck;
    
    // 4. Monthly totals
    const totalMonthly = Math.max(0, totalWeekly * 4);

    // Update Result UI
    weeklySouls.textContent = totalWeekly.toLocaleString();
    monthlySouls.textContent = totalMonthly.toLocaleString();

    // 5. Update Leaderboard Target Progress bar (Goal = 1,000 Souls)
    const goalTarget = 1000;
    const progressPercent = Math.min(100, Math.max(0, Math.round((totalMonthly / goalTarget) * 100)));
    
    if (progressBar && progressText) {
      progressBar.style.width = `${progressPercent}%`;
      progressText.textContent = `${progressPercent}%`;
    }
  }

  // Attach sliders event listeners
  if (checkinsInput && messagesInput && casinoInput) {
    checkinsInput.addEventListener('input', calculateEarnings);
    messagesInput.addEventListener('input', calculateEarnings);
    casinoInput.addEventListener('input', calculateEarnings);
    
    // Initial run
    calculateEarnings();
  }

  // ==========================================
  // SCROLL ACTIVE SECTION NAV HIGHLIGHTING
  // ==========================================
  const sections = document.querySelectorAll('section, header');
  const navLinks = document.querySelectorAll('.nav-link');

  window.addEventListener('scroll', () => {
    let current = '';
    const scrollPos = window.scrollY + 100; // offset for nav bar

    sections.forEach(section => {
      const top = section.offsetTop;
      const height = section.offsetHeight;
      if (scrollPos >= top && scrollPos < top + height) {
        current = section.getAttribute('id');
      }
    });

    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${current}`) {
        link.classList.add('active');
      }
    });
  });

});
