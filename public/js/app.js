document.addEventListener('DOMContentLoaded', () => {
  const socket = window.socketManager.connect();

  let myToken = localStorage.getItem('minigame_token') || null;
  let currentRoom = null;
  let isSoundEnabled = true;

  // DOM 요소 선택자
  const els = {
    mainContainer: document.getElementById('mainContainer'),
    roomBadge: document.getElementById('roomBadge'),
    displayRoomCode: document.getElementById('displayRoomCode'),
    btnSoundToggle: document.getElementById('btnSoundToggle'),

    // Views
    viewHome: document.getElementById('viewHome'),
    viewLobby: document.getElementById('viewLobby'),
    viewGame: document.getElementById('viewGame'),
    viewResult: document.getElementById('viewResult'),

    // Home
    inputNickname: document.getElementById('inputNickname'),
    inputRoomCode: document.getElementById('inputRoomCode'),
    btnCreateRoom: document.getElementById('btnCreateRoom'),
    btnJoinRoom: document.getElementById('btnJoinRoom'),

    // Lobby
    selectGameType: document.getElementById('selectGameType'),
    inputPenalty: document.getElementById('inputPenalty'),
    playerCount: document.getElementById('playerCount'),
    lobbyPlayerList: document.getElementById('lobbyPlayerList'),
    btnCopyInvite: document.getElementById('btnCopyInvite'),
    btnStartGame: document.getElementById('btnStartGame'),
    btnLeaveLobby: document.getElementById('btnLeaveLobby'),

    // Game (Crocodile)
    turnAlertBox: document.getElementById('turnAlertBox'),
    currentTurnName: document.getElementById('currentTurnName'),
    turnNoticeSub: document.getElementById('turnNoticeSub'),
    crocJawUpper: document.getElementById('crocJawUpper'),
    teethGrid: document.getElementById('teethGrid'),
    gameGuideBanner: document.getElementById('gameGuideBanner'),

    // Result
    resultLoserName: document.getElementById('resultLoserName'),
    resultPenaltyText: document.getElementById('resultPenaltyText'),
    btnShareKakao: document.getElementById('btnShareKakao'),
    btnPlayAgain: document.getElementById('btnPlayAgain')
  };

  // 사운드 토글
  els.btnSoundToggle.addEventListener('click', () => {
    isSoundEnabled = !isSoundEnabled;
    window.soundFx.isMuted = !isSoundEnabled;
    els.btnSoundToggle.textContent = isSoundEnabled ? '🔊' : '🔇';
    els.btnSoundToggle.classList.toggle('text-rose-400', !isSoundEnabled);
  });

  // 닉네임 자동 복원
  const savedNick = localStorage.getItem('minigame_nickname');
  if (savedNick && els.inputNickname) els.inputNickname.value = savedNick;

  // 화면 전환 헬퍼
  function showView(viewName) {
    els.viewHome.classList.add('hidden');
    els.viewLobby.classList.add('hidden');
    els.viewGame.classList.add('hidden');
    els.viewResult.classList.add('hidden');

    if (viewName === 'home') {
      els.viewHome.classList.remove('hidden');
      els.roomBadge.classList.add('hidden');
    } else if (viewName === 'lobby') {
      els.viewLobby.classList.remove('hidden');
      els.roomBadge.classList.remove('hidden');
    } else if (viewName === 'game') {
      els.viewGame.classList.remove('hidden');
      els.roomBadge.classList.remove('hidden');
    } else if (viewName === 'result') {
      els.viewResult.classList.remove('hidden');
      els.roomBadge.classList.remove('hidden');
    }
  }

  // URL 파라미터로 자동 방 코드 입력 (?room=CODE)
  const urlParams = new URLSearchParams(window.location.search);
  const inviteCode = urlParams.get('room');
  if (inviteCode && els.inputRoomCode) {
    els.inputRoomCode.value = inviteCode.toUpperCase();
  }

  // 1. 방 만들기 클릭
  els.btnCreateRoom.addEventListener('click', () => {
    window.soundFx.init();
    const nickname = els.inputNickname.value.trim() || '방장';
    localStorage.setItem('minigame_nickname', nickname);

    window.socketManager.createRoom(nickname, { gameType: 'crocodile' }, (res) => {
      if (res && res.success) {
        myToken = res.token;
        localStorage.setItem('minigame_token', myToken);
        currentRoom = res.room;
        renderLobby(res.room);
        showView('lobby');
      } else {
        alert(res ? res.error : '방 생성 실패');
      }
    });
  });

  // 2. 방 참여하기 클릭
  els.btnJoinRoom.addEventListener('click', () => {
    window.soundFx.init();
    const nickname = els.inputNickname.value.trim() || '참가자';
    const roomCode = els.inputRoomCode.value.trim().toUpperCase();
    if (!roomCode || roomCode.length < 4) {
      alert('방 코드 4자리를 입력해주세요.');
      return;
    }
    localStorage.setItem('minigame_nickname', nickname);

    window.socketManager.joinRoom(roomCode, nickname, myToken, (res) => {
      if (res && res.success) {
        myToken = res.player.token;
        localStorage.setItem('minigame_token', myToken);
        currentRoom = res.room;
        renderLobby(res.room);
        showView('lobby');
      } else {
        alert(res ? res.error : '방 참가 실패');
      }
    });
  });

  // 3. 초대 링크 복사
  els.btnCopyInvite.addEventListener('click', () => {
    if (!currentRoom) return;
    const inviteUrl = `${window.location.origin}?room=${currentRoom.id}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      alert('초대 링크가 복사되었습니다! 카톡으로 친구들에게 공유하세요.');
    });
  });

  // 4. 게임 시작 클릭 (방장)
  els.btnStartGame.addEventListener('click', () => {
    if (!currentRoom) return;
    const penalty = els.inputPenalty.value.trim() || '오늘 커피 쏘기! ☕';
    window.socketManager.updateSettings(currentRoom.id, myToken, {
      roles: [penalty, '생존 (통과)']
    }, () => {
      window.socketManager.startGame(currentRoom.id, myToken, (res) => {
        if (!res || !res.success) {
          alert(res ? res.error : '게임 시작 실패');
        }
      });
    });
  });

  // 5. 방 나가기
  els.btnLeaveLobby.addEventListener('click', () => {
    if (!currentRoom) return;
    window.socketManager.leaveRoom(currentRoom.id, myToken, () => {
      currentRoom = null;
      showView('home');
    });
  });

  // 6. 대기실 렌더링
  function renderLobby(room) {
    currentRoom = room;
    els.displayRoomCode.textContent = room.id;
    els.playerCount.textContent = room.players.length;

    const me = room.players.find(p => p.token === myToken);
    const isHost = me && me.isHost;

    els.selectGameType.disabled = !isHost;
    els.inputPenalty.disabled = !isHost;
    els.btnStartGame.classList.toggle('hidden', !isHost);

    els.lobbyPlayerList.innerHTML = room.players.map(p => `
      <div class="p-3 rounded-xl border flex items-center justify-between ${
        p.token === myToken ? 'bg-amber-500/10 border-amber-500/50 text-amber-200' : 'bg-slate-900 border-slate-800 text-slate-200'
      }">
        <span class="font-bold truncate">${p.nickname}</span>
        ${p.isHost ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-black shrink-0">👑 방장</span>' : ''}
      </div>
    `).join('');
  }

  // 7. 인게임 렌더링 (악어 이빨)
  function renderCrocodileGame(room) {
    currentRoom = room;
    const state = room.gameState;
    if (!state) return;

    // 악어 윗턱 닫힘 애니메이션 초기화 (입 열림 상태)
    els.crocJawUpper.classList.remove('croc-jaw-closed');
    els.mainContainer.classList.remove('shake-effect');

    const isMyTurn = state.currentTurnToken === myToken;

    if (isMyTurn) {
      window.soundFx.playTurn();
      window.soundFx.vibrate(25);
      els.turnAlertBox.className = 'text-center p-3 rounded-2xl bg-emerald-950/80 border-2 border-emerald-500 transition shadow-lg';
      els.currentTurnName.textContent = '👉 당신의 차례입니다!';
      els.currentTurnName.className = 'text-2xl font-black text-emerald-300 animate-bounce mt-0.5';
      els.turnNoticeSub.textContent = '⚠️ 신중하게 이빨 하나를 터치하세요!';
      els.turnNoticeSub.className = 'text-xs text-emerald-200 font-bold mt-1';
      els.gameGuideBanner.textContent = '당신의 손에 운명이 걸려 있습니다!';
    } else {
      els.turnAlertBox.className = 'text-center p-3 rounded-2xl bg-slate-800 border border-slate-700 transition';
      els.currentTurnName.textContent = `${state.currentTurnNickname} 차례 대기 중...`;
      els.currentTurnName.className = 'text-xl font-bold text-amber-300 mt-0.5';
      els.turnNoticeSub.textContent = '악어가 입을 벌리고 기다리고 있습니다...';
      els.turnNoticeSub.className = 'text-xs text-slate-400 font-semibold mt-1';
      els.gameGuideBanner.textContent = `${state.currentTurnNickname}님이 이빨을 고르고 있습니다.`;
    }

    // 이빨 렌더링
    els.teethGrid.innerHTML = '';
    for (let i = 0; i < state.teethCount; i++) {
      const isPressed = state.pressedTeeth.includes(i);
      const tooth = document.createElement('button');
      tooth.setAttribute('data-tooth-index', i);

      if (isPressed) {
        tooth.className = 'tooth-btn tooth-pressed flex items-center justify-center';
        tooth.disabled = true;
      } else {
        tooth.className = `tooth-btn flex items-center justify-center font-black text-sm text-slate-700 ${
          isMyTurn ? 'cursor-pointer hover:brightness-105 active:scale-95' : 'cursor-not-allowed opacity-80'
        }`;
        tooth.innerHTML = '<span class="text-xs text-slate-400">🦷</span>';

        if (isMyTurn) {
          tooth.addEventListener('click', () => {
            window.soundFx.playClick();
            window.soundFx.vibrate(30);
            tooth.disabled = true;
            tooth.classList.add('tooth-pressed');

            window.socketManager.sendGameAction(room.id, myToken, 'pressTooth', { toothIndex: i }, (res) => {
              if (!res || !res.success) {
                alert(res ? res.error : '조작 실패');
              }
            });
          });
        } else {
          tooth.disabled = true;
        }
      }

      els.teethGrid.appendChild(tooth);
    }
  }

  // 8. 최종 결과 렌더링 & 카카오톡 전송
  function renderResult(data) {
    const loser = data.loser;
    els.resultLoserName.textContent = loser ? loser.nickname : '미정';
    els.resultPenaltyText.textContent = (currentRoom && currentRoom.settings.roles[0]) || '오늘 커피 쏘기! ☕';

    // 카카오톡 공유 버튼 이벤트
    els.btnShareKakao.onclick = async () => {
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

      const shareText = `🏆 [MiniGame Hub] 악어 이빨 복불복 결과! 🏆
방 코드: ${currentRoom.id}
일시: ${dateStr}

🐊 최종 물린 사람 (벌칙):
• ${loser.nickname} 👉 ${els.resultPenaltyText.textContent}

🎮 한 판 더 하러 가기:
${window.location.origin}`;

      if (navigator.share) {
        try {
          await navigator.share({ text: shareText });
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }

      navigator.clipboard.writeText(shareText).then(() => {
        alert('카톡 공유 결과가 복사되었습니다! 단톡방에 붙여넣기(Ctrl+V)하세요.');
      });
    };

    // 대기실로 리셋 버튼
    els.btnPlayAgain.onclick = () => {
      window.socketManager.resetToLobby(currentRoom.id, myToken, (res) => {
        if (!res || !res.success) alert(res ? res.error : '대기실 복귀 실패');
      });
    };
  }

  // 소켓 브로드캐스트 이벤트 리스너
  socket.on('roomUpdated', (room) => {
    currentRoom = room;
    if (room.status === 'LOBBY') {
      renderLobby(room);
      showView('lobby');
    }
  });

  socket.on('gameStarted', (room) => {
    currentRoom = room;
    renderCrocodileGame(room);
    showView('game');
  });

  // 안전한 이빨을 눌렀을 때
  socket.on('toothPressed', (data) => {
    currentRoom = data.room;
    window.soundFx.playSafe();
    renderCrocodileGame(data.room);
  });

  // 꽝 이빨을 눌러 악어가 쾅 물었을 때 (극적인 연출!)
  socket.on('gameFinished', (data) => {
    currentRoom = data.room;

    // 1. 악어 윗턱 닫힘 연출
    els.crocJawUpper.classList.add('croc-jaw-closed');

    // 2. 화면 전체 셰이크 & 붉은 경고
    els.mainContainer.classList.add('shake-effect');
    els.turnAlertBox.className = 'text-center p-3 rounded-2xl bg-rose-950 border-2 border-rose-500 shadow-xl';
    els.currentTurnName.textContent = `💥 콰앙! ${data.loser.nickname}님이 물렸습니다!`;
    els.currentTurnName.className = 'text-2xl font-black text-rose-300 animate-pulse mt-0.5';
    els.turnNoticeSub.textContent = '악어가 입을 쾅 닫았습니다!';

    // 3. 묵직한 사운드 & 진동
    window.soundFx.playChomp();
    window.soundFx.vibrate([80, 50, 80, 50, 300]);

    // 4. 1.2초 후 결과 화면으로 전환
    setTimeout(() => {
      renderResult(data);
      showView('result');
    }, 1200);
  });

  socket.on('roomDestroyed', (data) => {
    alert('방이 해산되었거나 방장이 나갔습니다.');
    currentRoom = null;
    showView('home');
  });
});
