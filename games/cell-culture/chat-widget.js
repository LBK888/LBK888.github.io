(function() {

  const style = document.createElement('style');
  style.innerHTML = `
  .hidden {
    display: none !important;
  }
  #chat-widget-container {
    position: fixed;
    bottom: 20px;
    right: 20px;
    flex-direction: column;
  }
  #chat-bubble {
    width: 4rem;
    height: 4rem;
    background-color: #1f2937;
    border-radius: 9999px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 1.875rem;
  }
  #chat-bubble svg {
    width: 2.5rem;
    height: 2.5rem;
    color: white;
  }
  #chat-popup {
    height: 70vh;
    max-height: 70vh;
    transition: all 0.3s;
    overflow: hidden;
    position: absolute;
    bottom: 5rem;
    right: 0;
    width: 24rem;
    background-color: white;
    border-radius: 0.375rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    display: flex;
    flex-direction: column;
  }
  #chat-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    background-color: #1f2937;
    color: white;
    border-top-left-radius: 0.375rem;
    border-top-right-radius: 0.375rem;
  }
  #chat-header h3 {
    margin: 0;
    font-size: 1.125rem;
  }
  #close-popup {
    background: transparent;
    border: none;
    color: white;
    cursor: pointer;
  }
  #close-popup svg {
    height: 1.5rem;
    width: 1.5rem;
  }
  #chat-messages {
    flex: 1;
    padding: 1rem;
    overflow-y: auto;
  }
  #chat-input-container {
    padding: 1rem;
    border-top: 1px solid #e5e7eb;
  }
  .input-wrapper {
    display: flex;
    gap: 1rem;
    align-items: center;
  }
  #chat-input {
    flex: 1;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    padding: 0.5rem 1rem;
    outline: none;
    width: 75%;
  }
  #chat-submit {
    background-color: #1f2937;
    color: white;
    border-radius: 0.375rem;
    padding: 0.5rem 1rem;
    cursor: pointer;
    border: none;
  }
  .footer-text {
    display: flex;
    text-align: center;
    font-size: 0.75rem;
    padding-top: 1rem;
  }
  .footer-text span {
    flex: 1;
  }
  .footer-text a {
    color: #4f46e5;
    text-decoration: none;
  }
  .user-message {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 0.75rem;
  }
  .user-message-content {
    background-color: #1f2937;
    color: white;
    border-radius: 0.5rem;
    padding: 0.5rem 1rem;
    max-width: 70%;
  }
  .bot-message {
    display: flex;
    margin-bottom: 0.75rem;
  }
  .bot-message-content {
    background-color: #e5e7eb;
    color: black;
    border-radius: 0.5rem;
    padding: 0.5rem 1rem;
    max-width: 70%;
  }
  @media (max-width: 768px) {
    #chat-popup {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 100%;
      max-height: 100%;
      border-radius: 0;
    }
    #chat-bubble {
      width: 3rem;
      height: 3rem;
    }
    
    #chat-bubble svg {
      width: 1.8rem;
      height: 1.8rem;
    }
    
    #chat-widget-container {
      bottom: 10px;
      right: 10px;
    }
  }
  @media (max-width: 480px) {
    #chat-bubble {
      width: 2.5rem;
      height: 2.5rem;
    }
    
    #chat-bubble svg {
      width: 1.5rem;
      height: 1.5rem;
    }
  }
  `;

  document.head.appendChild(style);

  // 先創建容器
  const chatWidgetContainer = document.createElement('div');
  chatWidgetContainer.id = 'chat-widget-container';
  
  // Inject the HTML
  chatWidgetContainer.innerHTML = `
    <div id="chat-bubble">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    </div>
    <div id="chat-popup" class="hidden">
      <div id="chat-header">
        <h3>Cell Master</h3>
        <button id="close-popup">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div id="chat-messages"></div>
      <div id="chat-input-container">
        <div class="input-wrapper">
          <input type="text" id="chat-input" placeholder="Type your message...">
          <button id="chat-submit">Send</button>
        </div>
        <div class="footer-text">
          <span>By <a href="http://lbk.tw/" target="_blank">LBK.tw</a></span>
        </div>
      </div>
    </div>
  `;
  
  // 將容器添加到 body
  document.body.appendChild(chatWidgetContainer);

  // 在 DOM 元素加入後再綁定事件監聽器
  const chatInput = document.getElementById('chat-input');
  const chatSubmit = document.getElementById('chat-submit');
  const chatMessages = document.getElementById('chat-messages');
  const chatBubble = document.getElementById('chat-bubble');
  const chatPopup = document.getElementById('chat-popup');
  const closePopup = document.getElementById('close-popup');

  function togglePopup() {
    chatPopup.classList.toggle('hidden');
    if (!chatPopup.classList.contains('hidden')) {
      chatInput.focus();
    }
  }

  chatBubble.addEventListener('click', togglePopup);
  closePopup.addEventListener('click', togglePopup);

  chatSubmit.addEventListener('click', function() {
    
    const message = chatInput.value.trim();
    if (!message) return;
    
    chatMessages.scrollTop = chatMessages.scrollHeight;

    chatInput.value = '';

    onUserRequest(message);

  });

  chatInput.addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
      chatSubmit.click();
    }
  });

  function onUserRequest(message) {
    // Handle user request here
    console.log('User request:', message);
  
    // Display user message
    const messageElement = document.createElement('div');
    messageElement.className = 'user-message';
    messageElement.innerHTML = `
      <div class="user-message-content">
        ${message}
      </div>
    `;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  
    chatInput.value = '';
  
    // Reply to the user
    setTimeout(function() {
      reply('Hi! This is a sample reply. I will be functional soon');
    }, 500);
  }
  
  function reply(message) {
    const chatMessages = document.getElementById('chat-messages');
    const replyElement = document.createElement('div');
    replyElement.className = 'bot-message';
    replyElement.innerHTML = `
      <div class="bot-message-content">
        ${message}
      </div>
    `;
    chatMessages.appendChild(replyElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
  
})();
