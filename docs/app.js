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

    // 1. Calculate checkin earnings per week
    // s daily / s checkin = random 500-1000 (avg ~750). /checkin = fixed 20.
    // Simulator uses the prefix command average (750) as the estimate.
    const checkinWeekly = checkins * 750;

    // 2. Calculate messaging earnings:
    // - Every 10 qualifying messages (min 5 words, 15s cooldown) awards 100 Souls
    // - Max messages countable per day ≈ 5,760 (every 15s for 24h), but practically capped
    // - Daily cap = 5,000 Souls => max 50 milestones/day
    // - At 15s per message, 1 milestone = 10 messages = 150s ≈ 2.5 min
    const MILESTONE_INTERVAL = 10;       // messages per milestone
    const MILESTONE_REWARD = 100;        // Souls per milestone
    const DAILY_CAP_SOULS = 5000;        // maximum message earnings per day
    const COOLDOWN_SECONDS = 15;         // between counted messages

    // Messages per day that can be counted (limited by cooldown)
    const countablePerDay = Math.floor((24 * 3600) / COOLDOWN_SECONDS);
    const actualCounted = Math.min(messages, countablePerDay);
    const milestonesPerDay = Math.floor(actualCounted / MILESTONE_INTERVAL);
    const rawDailySouls = milestonesPerDay * MILESTONE_REWARD;
    const messageDailySouls = Math.min(rawDailySouls, DAILY_CAP_SOULS);
    const messageWeekly = messageDailySouls * 7;

    // 3. Weekly totals
    const totalWeekly = checkinWeekly + messageWeekly + casinoLuck;
    
    // 4. Monthly totals
    const totalMonthly = Math.max(0, totalWeekly * 4);

    // Update Result UI
    weeklySouls.textContent = totalWeekly.toLocaleString();
    monthlySouls.textContent = totalMonthly.toLocaleString();

    // 5. Update Leaderboard Target Progress bar (Goal = 50,000 Souls)
    const goalTarget = 50000;
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
      const href = link.getAttribute('href');
      // Only highlight local anchors that match the current section ID
      if (href && href.startsWith('#')) {
        link.classList.remove('active');
        if (href === `#${current}`) {
          link.classList.add('active');
        }
      }
    });
  });

  // ==========================================
  // TOP SERVERS LEADERBOARD FETCH
  // ==========================================
  async function loadPublicLeaderboard() {
    const container = document.getElementById('public-leaderboard-container');
    if (!container) return;
    try {
      const response = await fetch('/api/public/top-servers');
      if (!response.ok) throw new Error('Failed to fetch server standings.');
      const data = await response.json();
      
      if (!data || data.length === 0) {
        container.innerHTML = `<div class="loading-state"><i class="fa-solid fa-circle-info"></i>No server standings available yet.</div>`;
        return;
      }
      
      let html = `
        <table class="leaderboard-table">
          <thead>
            <tr>
              <th style="width: 80px;">Rank</th>
              <th>Server</th>
              <th style="text-align: right;">Total Souls</th>
            </tr>
          </thead>
          <tbody>
      `;
      
      data.forEach((server, index) => {
        const rank = index + 1;
        let rankClass = '';
        if (rank === 1) rankClass = 'rank-1';
        else if (rank === 2) rankClass = 'rank-2';
        else if (rank === 3) rankClass = 'rank-3';
        
        // Short name or initials if there's no icon
        const initials = server.name ? server.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?';
        
        const iconHtml = server.icon 
          ? `<img src="${server.icon}" class="lb-server-icon" alt="${server.name}">`
          : `<div class="lb-server-icon">${initials}</div>`;
          
        html += `
          <tr class="leaderboard-row">
            <td class="lb-rank ${rankClass}">#${rank}</td>
            <td>
              <div class="lb-server-info">
                ${iconHtml}
                <span class="lb-server-name">${server.name || 'Unknown Server'}</span>
              </div>
            </td>
            <td class="lb-souls">${Number(server.totalCoins).toLocaleString()} <span>Souls</span></td>
          </tr>
        `;
      });
      
      html += `
          </tbody>
        </table>
      `;
      container.innerHTML = html;
    } catch (error) {
      console.error(error);
      container.innerHTML = `<div class="loading-state"><i class="fa-solid fa-triangle-exclamation"></i>Error loading server standings.</div>`;
    }
  }

  loadPublicLeaderboard();

});
