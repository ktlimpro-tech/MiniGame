document.addEventListener('DOMContentLoaded', () => {
  const socket = window.socketManager.connect();

  let myToken = null;
  let currentRoom = null;
  let isSoundEnabled = true;

  // 세션 스토리지 기반 방별 토큰 관리 (탭/창 간 토큰 충돌 원천 차단)
  const getSessionToken = (roomCode) => roomCode ? sessionStorage.getItem(`minigame_token_${roomCode}`) : null;
  const setSessionToken = (roomCode, token) => {
    if (roomCode && token) sessionStorage.setItem(`minigame_token_${roomCode}`, token);
  };
  const clearSessionToken = (roomCode) => {
    if (roomCode) sessionStorage.removeItem(`minigame_token_${roomCode}`);
  };

  // 기존 localStorage에 혹시 남아있을 수 있는 단일 minigame_token 삭제 (이전 버전 잔여 데이터 정리)
  localStorage.removeItem('minigame_token');

  // DOM 요소 선택자
  const els = {
    mainContainer: document.getElementById('mainContainer'),
    roomBadge: document.getElementById('roomBadge'),
    displayRoomCode: document.getElementById('displayRoomCode'),
    btnSoundToggle: document.getElementById('btnSoundToggle'),
    btnLeaveRoomHeader: document.getElementById('btnLeaveRoomHeader'),

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
    inviteBanner: document.getElementById('inviteBanner'),
    inviteRoomDisplay: document.getElementById('inviteRoomDisplay'),
    sectionNormalActions: document.getElementById('sectionNormalActions'),
    sectionInviteActions: document.getElementById('sectionInviteActions'),
    btnJoinInvited: document.getElementById('btnJoinInvited'),
    btnSwitchToCreate: document.getElementById('btnSwitchToCreate'),

    // Lobby
    selectGameType: document.getElementById('selectGameType'),
    roleNotice: document.getElementById('roleNotice'),
    inputPenalty: document.getElementById('inputPenalty'),
    playerCount: document.getElementById('playerCount'),
    lobbyPlayerList: document.getElementById('lobbyPlayerList'),
    btnCopyInvite: document.getElementById('btnCopyInvite'),
    btnStartGame: document.getElementById('btnStartGame'),
    btnLeaveLobby: document.getElementById('btnLeaveLobby'),

    // Game (Crocodile)
    turnAlertBox: document.getElementById('turnAlertBox'),
    turnTimerProgress: document.getElementById('turnTimerProgress'),
    turnTimerSeconds: document.getElementById('turnTimerSeconds'),
    rageIndicator: document.getElementById('rageIndicator'),
    currentTurnName: document.getElementById('currentTurnName'),
    turnNoticeSub: document.getElementById('turnNoticeSub'),
    crocStage: document.getElementById('crocStage'),
    crocJawUpper: document.getElementById('crocJawUpper'),
    crocSnout: document.getElementById('crocSnout'),
    crocEyeLeft: document.getElementById('crocEyeLeft'),
    crocEyeRight: document.getElementById('crocEyeRight'),
    crocSmokeLeft: document.getElementById('crocSmokeLeft'),
    crocSmokeRight: document.getElementById('crocSmokeRight'),
    crocMouth: document.getElementById('crocMouth'),
    remainingTeethCount: document.getElementById('remainingTeethCount'),
    reactionContainer: document.getElementById('reactionContainer'),
    teethGrid: document.getElementById('teethGrid'),
    gameGuideBanner: document.getElementById('gameGuideBanner'),

    // Result
    resultLoserName: document.getElementById('resultLoserName'),
    resultPenaltyText: document.getElementById('resultPenaltyText'),
    btnShareKakao: document.getElementById('btnShareKakao'),
    btnPlayAgain: document.getElementById('btnPlayAgain'),
    btnLeaveResult: document.getElementById('btnLeaveResult'),

    // Modal
    modalInvite: document.getElementById('modalInvite'),
    modalInviteInput: document.getElementById('modalInviteInput'),
    btnModalCopy: document.getElementById('btnModalCopy'),
    btnCloseInviteModal: document.getElementById('btnCloseInviteModal'),
    btnConfirmInviteModal: document.getElementById('btnConfirmInviteModal'),

    // Custom Alert & Confirm Dialog
    modalDialog: document.getElementById('modalDialog'),
    modalDialogIcon: document.getElementById('modalDialogIcon'),
    modalDialogTitle: document.getElementById('modalDialogTitle'),
    modalDialogMessage: document.getElementById('modalDialogMessage'),
    btnCloseDialogModal: document.getElementById('btnCloseDialogModal'),
    btnDialogCancel: document.getElementById('btnDialogCancel'),
    btnDialogConfirm: document.getElementById('btnDialogConfirm')
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
  if (savedNick && els.inputNickname) {
    els.inputNickname.value = savedNick;
  }

  // 화면 전환 헬퍼
  function showView(viewName) {
    els.viewHome.classList.add('hidden');
    els.viewLobby.classList.add('hidden');
    els.viewGame.classList.add('hidden');
    els.viewResult.classList.add('hidden');

    if (viewName === 'home') {
      els.viewHome.classList.remove('hidden');
      els.roomBadge.classList.add('hidden');
      if (els.btnLeaveRoomHeader) els.btnLeaveRoomHeader.classList.add('hidden');
    } else {
      if (viewName === 'lobby') els.viewLobby.classList.remove('hidden');
      else if (viewName === 'game') els.viewGame.classList.remove('hidden');
      else if (viewName === 'result') els.viewResult.classList.remove('hidden');

      els.roomBadge.classList.remove('hidden');
      if (els.btnLeaveRoomHeader) els.btnLeaveRoomHeader.classList.remove('hidden');
    }
  }

  // 초대 모드 토글 함수
  function setInviteMode(code) {
    if (code && code.length >= 4) {
      if (els.inviteBanner) els.inviteBanner.classList.remove('hidden');
      if (els.inviteRoomDisplay) els.inviteRoomDisplay.textContent = code.toUpperCase();
      if (els.sectionNormalActions) els.sectionNormalActions.classList.add('hidden');
      if (els.sectionInviteActions) els.sectionInviteActions.classList.remove('hidden');
      if (els.inputRoomCode) els.inputRoomCode.value = code.toUpperCase();
    } else {
      if (els.inviteBanner) els.inviteBanner.classList.add('hidden');
      if (els.sectionNormalActions) els.sectionNormalActions.classList.remove('hidden');
      if (els.sectionInviteActions) els.sectionInviteActions.classList.add('hidden');
    }
  }

  // URL 파라미터로 자동 방 코드 입력 (?room=CODE)
  const urlParams = new URLSearchParams(window.location.search);
  const inviteCode = urlParams.get('room');
  if (inviteCode && inviteCode.trim().length >= 4) {
    const code = inviteCode.trim().toUpperCase();
    setInviteMode(code);

    // 만약 이 창(탭)에서 이미 해당 방에 참여 중이던 토큰이 남아있다면(새로고침 시) 자동 재연결 시도
    const savedTokenForThisRoom = getSessionToken(code);
    if (savedTokenForThisRoom && savedNick) {
      window.socketManager.joinRoom(code, savedNick, savedTokenForThisRoom, (res) => {
        if (res && res.success) {
          myToken = res.player.token;
          setSessionToken(res.room.id, myToken);
          currentRoom = res.room;
          if (res.room.status === 'LOBBY') {
            renderLobby(res.room);
            showView('lobby');
          } else if (res.room.status === 'PLAYING') {
            renderCrocodileGame(res.room);
            showView('game');
          }
        }
      });
    }
  }

  // 초대 모드에서 '내가 새로운 게임 방 만들기'를 눌렀을 때
  if (els.btnSwitchToCreate) {
    els.btnSwitchToCreate.addEventListener('click', () => {
      setInviteMode(null);
      // URL에서 ?room 파라미터 제거
      window.history.replaceState({}, document.title, window.location.pathname);
    });
  }

  // 방 참여 공통 실행 함수
  function executeJoinRoom(targetCode) {
    window.soundFx.init();
    const nickname = els.inputNickname.value.trim() || '참가자';
    const roomCode = (targetCode || els.inputRoomCode.value).trim().toUpperCase();

    if (!roomCode || roomCode.length < 4) {
      showAlert('방 코드 4자리를 정확히 입력해주세요.', { title: '입력 확인', icon: '🔑' });
      return;
    }
    localStorage.setItem('minigame_nickname', nickname);

    // 이 탭/창에서 해당 방에 저장된 토큰이 있는 경우에만 재연결 토큰 전달, 없으면 null(신규 참가)
    const existingSessionToken = getSessionToken(roomCode);

    window.socketManager.joinRoom(roomCode, nickname, existingSessionToken, (res) => {
      if (res && res.success) {
        myToken = res.player.token;
        setSessionToken(res.room.id, myToken);
        currentRoom = res.room;

        // 서버에서 중복 처리 등으로 최종 확정된 닉네임 동기화
        if (res.player && res.player.nickname) {
          els.inputNickname.value = res.player.nickname;
          localStorage.setItem('minigame_nickname', res.player.nickname);
        }

        renderLobby(res.room);
        showView('lobby');
      } else {
        showAlert(res ? res.error : '방 참가에 실패했습니다.', { title: '참가 실패', icon: '⚠️' });
      }
    });
  }

  // 1. 방 만들기 클릭
  els.btnCreateRoom.addEventListener('click', () => {
    window.soundFx.init();
    const nickname = els.inputNickname.value.trim() || '방장';
    localStorage.setItem('minigame_nickname', nickname);

    window.socketManager.createRoom(nickname, { gameType: 'crocodile' }, (res) => {
      if (res && res.success) {
        myToken = res.token;
        setSessionToken(res.room.id, myToken);
        currentRoom = res.room;
        renderLobby(res.room);
        showView('lobby');
      } else {
        showAlert(res ? res.error : '방 생성에 실패했습니다.', { title: '생성 실패', icon: '⚠️' });
      }
    });
  });

  // 2-A. 일반 코드로 방 참여하기 클릭
  els.btnJoinRoom.addEventListener('click', () => {
    executeJoinRoom();
  });

  // 2-B. 초대 링크 전용 원클릭 바로 참여하기 클릭
  if (els.btnJoinInvited) {
    els.btnJoinInvited.addEventListener('click', () => {
      const code = els.inviteRoomDisplay ? els.inviteRoomDisplay.textContent.trim() : null;
      executeJoinRoom(code);
    });
  }

  // 닉네임 입력창에서 엔터(Enter) 키 입력 편의 지원
  els.inputNickname.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const isInviteActive = !els.sectionInviteActions.classList.contains('hidden');
      if (isInviteActive) {
        const code = els.inviteRoomDisplay ? els.inviteRoomDisplay.textContent.trim() : null;
        executeJoinRoom(code);
      } else {
        if (els.inputRoomCode && els.inputRoomCode.value.trim().length >= 4) {
          executeJoinRoom();
        } else {
          els.btnCreateRoom.click();
        }
      }
    }
  });

  // 커스텀 초대 모달 제어 함수
  function showInviteModal(url) {
    if (!els.modalInvite) return;
    els.modalInviteInput.value = url;
    els.btnModalCopy.textContent = '복사';
    els.btnModalCopy.className = 'absolute right-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs transition active:scale-95 shadow';
    els.modalInvite.classList.remove('hidden');
    setTimeout(() => {
      els.modalInviteInput.select();
    }, 50);
  }

  function hideInviteModal() {
    if (!els.modalInvite) return;
    els.modalInvite.classList.add('hidden');
  }

  // 범용 커스텀 팝업 (Alert / Confirm) - 브라우저 기본 창 완전 대체
  let activeDialogResolve = null;

  function closeDialog(result = false) {
    if (!els.modalDialog) return;
    els.modalDialog.classList.add('hidden');
    if (typeof activeDialogResolve === 'function') {
      activeDialogResolve(result);
      activeDialogResolve = null;
    }
  }

  function showAlert(message, options = {}) {
    return new Promise((resolve) => {
      if (!els.modalDialog) return resolve(true);
      activeDialogResolve = resolve;

      els.modalDialogTitle.textContent = options.title || '알림';
      els.modalDialogIcon.textContent = options.icon || '📢';
      els.modalDialogMessage.textContent = message;

      els.btnDialogCancel.classList.add('hidden');
      els.btnDialogConfirm.textContent = options.confirmText || '확인';
      els.btnDialogConfirm.className = options.danger
        ? 'flex-1 py-3 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-50 font-black text-sm transition active:scale-95 shadow'
        : 'flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm transition active:scale-95 shadow';

      els.modalDialog.classList.remove('hidden');
    });
  }

  function showConfirm(message, options = {}) {
    return new Promise((resolve) => {
      if (!els.modalDialog) return resolve(false);
      activeDialogResolve = resolve;

      els.modalDialogTitle.textContent = options.title || '확인';
      els.modalDialogIcon.textContent = options.icon || '❓';
      els.modalDialogMessage.textContent = message;

      els.btnDialogCancel.classList.remove('hidden');
      els.btnDialogCancel.textContent = options.cancelText || '취소';

      els.btnDialogConfirm.textContent = options.confirmText || '확인';
      els.btnDialogConfirm.className = options.danger
        ? 'flex-1 py-3 rounded-xl bg-rose-500 hover:bg-rose-400 text-slate-50 font-black text-sm transition active:scale-95 shadow'
        : 'flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm transition active:scale-95 shadow';

      els.modalDialog.classList.remove('hidden');
    });
  }

  if (els.btnCloseDialogModal) {
    els.btnCloseDialogModal.addEventListener('click', () => closeDialog(false));
  }
  if (els.btnDialogCancel) {
    els.btnDialogCancel.addEventListener('click', () => closeDialog(false));
  }
  if (els.btnDialogConfirm) {
    els.btnDialogConfirm.addEventListener('click', () => closeDialog(true));
  }
  if (els.modalDialog) {
    els.modalDialog.addEventListener('click', (e) => {
      if (e.target === els.modalDialog) closeDialog(false);
    });
  }

  // 3. 초대 링크 복사 (브라우저 기본 alert 대신 세련된 커스텀 반응형 팝업)
  els.btnCopyInvite.addEventListener('click', () => {
    if (!currentRoom) return;
    const inviteUrl = `${window.location.origin}?room=${currentRoom.id}`;

    // 1) 클립보드 자동 복사 백그라운드 시도
    if (navigator.clipboard) {
      navigator.clipboard.writeText(inviteUrl).then(() => {
        // 복사 성공 시 모달 오픈
        showInviteModal(inviteUrl);
      }).catch(() => {
        showInviteModal(inviteUrl);
      });
    } else {
      showInviteModal(inviteUrl);
    }
  });

  // 모달 내부 복사 버튼 클릭
  if (els.btnModalCopy) {
    els.btnModalCopy.addEventListener('click', () => {
      const url = els.modalInviteInput.value;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
          els.btnModalCopy.textContent = '✅ 복사됨!';
          els.btnModalCopy.className = 'absolute right-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-black text-xs transition shadow';
        }).catch(() => {
          els.modalInviteInput.select();
        });
      } else {
        els.modalInviteInput.select();
        document.execCommand('copy');
        els.btnModalCopy.textContent = '✅ 복사됨!';
        els.btnModalCopy.className = 'absolute right-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-black text-xs transition shadow';
      }
    });
  }

  // 모달 닫기 이벤트 리스너들
  if (els.btnCloseInviteModal) {
    els.btnCloseInviteModal.addEventListener('click', hideInviteModal);
  }
  if (els.btnConfirmInviteModal) {
    els.btnConfirmInviteModal.addEventListener('click', hideInviteModal);
  }
  if (els.modalInvite) {
    els.modalInvite.addEventListener('click', (e) => {
      if (e.target === els.modalInvite) hideInviteModal();
    });
  }

  // 대기실 실시간 설정 동기화 (방장의 벌칙 수정 및 게임 모드 변경)
  let penaltyDebounceTimer = null;
  function syncRoomSettings(immediate = false) {
    if (!currentRoom || !myToken) return;
    const me = currentRoom.players.find(p => p.token === myToken);
    if (!me || !me.isHost) return;

    const doSync = () => {
      const penalty = els.inputPenalty.value.trim() || '오늘 커피 쏘기! ☕';
      const gameType = els.selectGameType.value || 'crocodile';
      window.socketManager.updateSettings(currentRoom.id, myToken, {
        gameType,
        roles: [penalty, '생존 (통과)']
      });
    };

    if (immediate) {
      clearTimeout(penaltyDebounceTimer);
      doSync();
    } else {
      clearTimeout(penaltyDebounceTimer);
      penaltyDebounceTimer = setTimeout(doSync, 200);
    }
  }

  els.inputPenalty.addEventListener('input', () => syncRoomSettings(false));
  els.inputPenalty.addEventListener('change', () => syncRoomSettings(true));
  els.inputPenalty.addEventListener('blur', () => syncRoomSettings(true));
  els.selectGameType.addEventListener('change', () => syncRoomSettings(true));

  // 4. 게임 시작 클릭 (방장)
  els.btnStartGame.addEventListener('click', () => {
    if (!currentRoom) return;
    const penalty = els.inputPenalty.value.trim() || '오늘 커피 쏘기! ☕';
    window.socketManager.updateSettings(currentRoom.id, myToken, {
      roles: [penalty, '생존 (통과)']
    }, () => {
      window.socketManager.startGame(currentRoom.id, myToken, (res) => {
        if (!res || !res.success) {
          showAlert(res ? res.error : '게임을 시작할 수 없습니다.', { title: '시작 실패', icon: '⚠️' });
        }
      });
    });
  });

  // 5. 방 나가기 (공통 처리 함수)
  async function handleLeaveRoom() {
    if (!currentRoom) return;
    const me = currentRoom.players.find(p => p.token === myToken);
    const isHost = me && me.isHost;

    const confirmMsg = isHost
      ? '방장이 나가면 방 전체가 해산됩니다.\n정말 방을 나가시겠습니까?'
      : '현재 참여 중인 방에서 나가시겠습니까?';

    const confirmed = await showConfirm(confirmMsg, {
      title: isHost ? '방 해산 확인' : '방 나가기',
      icon: '🚪',
      confirmText: '나가기',
      cancelText: '취소',
      danger: true
    });

    if (!confirmed) return;

    const exitRoomId = currentRoom.id;
    window.socketManager.leaveRoom(exitRoomId, myToken, () => {
      clearSessionToken(exitRoomId);
      currentRoom = null;
      myToken = null;
      showView('home');
    });
  }

  if (els.btnLeaveLobby) els.btnLeaveLobby.addEventListener('click', handleLeaveRoom);
  if (els.btnLeaveRoomHeader) els.btnLeaveRoomHeader.addEventListener('click', handleLeaveRoom);
  if (els.btnLeaveResult) els.btnLeaveResult.addEventListener('click', handleLeaveRoom);

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

    // 벌칙 텍스트 및 게임 모드 실시간 동기화
    const penaltyText = (room.settings && room.settings.roles && room.settings.roles[0]) || '오늘 커피 쏘기! ☕';
    // 방장이 직접 타이핑하고 있는 중이 아닐 때만 동기화 (커서 튐 방지)
    if (!isHost || document.activeElement !== els.inputPenalty) {
      els.inputPenalty.value = penaltyText;
    }
    if (room.settings && room.settings.gameType) {
      els.selectGameType.value = room.settings.gameType;
    }

    if (els.roleNotice) {
      els.roleNotice.textContent = isHost ? '방장 설정 가능' : '방장이 실시간 설정 중';
      els.roleNotice.className = isHost ? 'text-[11px] text-amber-400 font-semibold' : 'text-[11px] text-slate-400 font-semibold';
    }

    els.lobbyPlayerList.innerHTML = room.players.map(p => {
      const isMe = p.token === myToken;
      return `
        <div class="p-3 rounded-xl border flex items-center justify-between ${
          isMe ? 'bg-amber-500/10 border-amber-500/50 text-amber-200' : 'bg-slate-900 border-slate-800 text-slate-200'
        }">
          <span class="font-bold truncate">${p.nickname}${isMe ? ' (나)' : ''}</span>
          ${p.isHost ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-black shrink-0">👑 방장</span>' : ''}
        </div>
      `;
    }).join('');
  }

  // ============================================
  // [긴장감 요소 1, 3, 4] 타이머, 분노, 리액션 시스템
  // ============================================

  let clientTimerInterval = null;
  let heartbeatInterval = null;

  function clearClientTurnTimer() {
    if (clientTimerInterval) {
      clearInterval(clientTimerInterval);
      clientTimerInterval = null;
    }
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (els.turnTimerProgress) {
      els.turnTimerProgress.classList.remove('timer-urgent');
    }
  }

  function startClientTurnTimer(turnExpiresAt, totalSec = 5, isMyTurn = false) {
    clearClientTurnTimer();
    if (!turnExpiresAt) return;

    const totalMs = totalSec * 1000;

    const updateTimer = () => {
      const remainingMs = Math.max(0, turnExpiresAt - Date.now());
      const remainingSec = (remainingMs / 1000).toFixed(1);
      const ratio = Math.max(0, Math.min(1, remainingMs / totalMs));

      if (els.turnTimerSeconds) {
        els.turnTimerSeconds.textContent = `${remainingSec}초`;
      }
      if (els.turnTimerProgress) {
        els.turnTimerProgress.style.width = `${ratio * 100}%`;
      }

      // 남은 시간 2.0초 이하일 때 긴급 심장박동 & 붉은 점멸
      if (remainingMs <= 2000 && remainingMs > 0) {
        if (els.turnTimerProgress && !els.turnTimerProgress.classList.contains('timer-urgent')) {
          els.turnTimerProgress.classList.add('timer-urgent');
        }
        if (isMyTurn && !heartbeatInterval) {
          window.soundFx.playHeartbeat();
          window.soundFx.vibrate(40);
          heartbeatInterval = setInterval(() => {
            window.soundFx.playHeartbeat();
            window.soundFx.vibrate(40);
          }, 450);
        }
      } else if (remainingMs > 2000) {
        if (els.turnTimerProgress) {
          els.turnTimerProgress.classList.remove('timer-urgent');
        }
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
      }

      if (remainingMs <= 0) {
        clearClientTurnTimer();
        if (els.turnTimerSeconds) els.turnTimerSeconds.textContent = '0.0초!';
      }
    };

    updateTimer();
    clientTimerInterval = setInterval(updateTimer, 80);
  }

  // 3. 후반부 악어 분노 연출 (0: 평온, 1: 경계/흥분, 2: 극도분노/폭주)
  function updateCrocodileRage(rageLevel, remainingTeeth) {
    if (els.remainingTeethCount) {
      els.remainingTeethCount.textContent = remainingTeeth;
    }

    // 기본 초기화
    if (els.crocJawUpper) els.crocJawUpper.classList.remove('croc-rage-shake');
    if (els.crocSmokeLeft) els.crocSmokeLeft.classList.add('hidden');
    if (els.crocSmokeRight) els.crocSmokeRight.classList.add('hidden');

    if (rageLevel === 2) {
      // 3단계: 극도 분노 폭주! (남은 이빨 <= 3)
      if (els.rageIndicator) {
        els.rageIndicator.textContent = '🐊 상태: 극도 분노! 🔥';
        els.rageIndicator.className = 'text-[11px] font-black text-rose-300 px-2.5 py-0.5 rounded-full bg-rose-950 border border-rose-500 animate-pulse';
      }
      if (els.crocJawUpper) els.crocJawUpper.classList.add('croc-rage-shake');
      if (els.crocSmokeLeft) els.crocSmokeLeft.classList.remove('hidden');
      if (els.crocSmokeRight) els.crocSmokeRight.classList.remove('hidden');
      if (els.crocEyeLeft) els.crocEyeLeft.className = 'w-9 h-9 rounded-full bg-rose-700 border-2 border-rose-400 flex items-center justify-center shadow-md';
      if (els.crocEyeRight) els.crocEyeRight.className = 'w-9 h-9 rounded-full bg-rose-700 border-2 border-rose-400 flex items-center justify-center shadow-md';
      try { window.soundFx.playGrowl(); } catch (e) {}
    } else if (rageLevel === 1) {
      // 2단계: 경계 및 흥분 (남은 이빨 <= 6)
      if (els.rageIndicator) {
        els.rageIndicator.textContent = '🐊 상태: 흥분 ⚠️';
        els.rageIndicator.className = 'text-[11px] font-black text-amber-300 px-2 py-0.5 rounded-full bg-amber-950 border border-amber-500';
      }
      if (els.crocEyeLeft) els.crocEyeLeft.className = 'w-9 h-9 rounded-full bg-amber-600 border-2 border-amber-400 flex items-center justify-center shadow-md';
      if (els.crocEyeRight) els.crocEyeRight.className = 'w-9 h-9 rounded-full bg-amber-600 border-2 border-amber-400 flex items-center justify-center shadow-md';
    } else {
      // 1단계: 평온
      if (els.rageIndicator) {
        els.rageIndicator.textContent = '🐊 상태: 평온';
        els.rageIndicator.className = 'text-[11px] font-bold text-slate-400 px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700';
      }
      if (els.crocEyeLeft) els.crocEyeLeft.className = 'w-9 h-9 rounded-full bg-emerald-600 border-2 border-emerald-400 flex items-center justify-center shadow-md';
      if (els.crocEyeRight) els.crocEyeRight.className = 'w-9 h-9 rounded-full bg-emerald-600 border-2 border-emerald-400 flex items-center justify-center shadow-md';
    }
  }

  // 4. 관전자 실시간 리액션 이모지 부유 연출 (DOM 최대 12개 캡 적용으로 렉 원천 차단)
  const MAX_REACTION_BUBBLES = 12;

  function spawnFloatingReaction(data) {
    if (!els.reactionContainer) return;

    // 화면에 버블이 너무 많으면 가장 오래된 버블을 즉시 제거 (모바일 렉 & 메모리 보호)
    while (els.reactionContainer.children.length >= MAX_REACTION_BUBBLES) {
      els.reactionContainer.removeChild(els.reactionContainer.firstChild);
    }

    const bubble = document.createElement('div');
    const randomLeft = 15 + Math.random() * 70; // 15% ~ 85% 가로 랜덤 위치
    bubble.className = 'floating-reaction absolute flex flex-col items-center pointer-events-none select-none z-30';
    bubble.style.left = `${randomLeft}%`;
    bubble.style.bottom = '10px';

    bubble.innerHTML = `
      <span class="text-3xl filter drop-shadow-md">${data.emoji}</span>
      <span class="text-[10px] font-black text-amber-300 bg-slate-950/80 px-2 py-0.5 rounded-full border border-slate-700/80 whitespace-nowrap shadow mt-0.5">
        ${data.senderNickname}: ${data.text}
      </span>
    `;

    els.reactionContainer.appendChild(bubble);
    setTimeout(() => {
      if (bubble.parentNode) bubble.parentNode.removeChild(bubble);
    }, 1650);
  }

  // 리액션 버튼 클릭 이벤트 (로컬 즉시 낙관적 렌더링 + 서버 송신 250ms 쓰로틀링)
  let lastReactionSentTime = 0;
  const REACTION_THROTTLE_MS = 250; // 초당 최대 4회로 서버 송신 제한

  document.querySelectorAll('.btn-reaction').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!currentRoom || !myToken) return;

      const emoji = btn.getAttribute('data-emoji') || '🐊';
      const text = btn.getAttribute('data-text') || '';

      // 1) 내 화면에는 즉시 반응 (소리 + 진동 + 로컬 버블 즉시 표시)
      window.soundFx.playPop();
      window.soundFx.vibrate(15);
      const myNick = els.inputNickname?.value?.trim() || '나';
      spawnFloatingReaction({
        emoji,
        text,
        senderNickname: myNick
      });

      // 2) 서버 소켓 송신은 250ms 쓰로틀링하여 네트워크 패킷 폭증 차단
      const now = Date.now();
      if (now - lastReactionSentTime >= REACTION_THROTTLE_MS) {
        lastReactionSentTime = now;
        socket.emit('sendReaction', {
          roomCode: currentRoom.id,
          token: myToken,
          emoji,
          text
        });
      }
    });
  });

  // 7. 인게임 렌더링 (악어 이빨)
  function renderCrocodileGame(room) {
    currentRoom = room;
    const state = room.gameState;
    if (!state) return;

    // 악어 윗턱 닫힘 애니메이션 초기화 (입 열림 상태)
    els.crocJawUpper.classList.remove('croc-jaw-closed');
    els.mainContainer.classList.remove('shake-effect');

    // 이빨 클릭 활성화 (락 해제)
    els.teethGrid.style.pointerEvents = 'auto';

    const isMyTurn = state.currentTurnToken === myToken;

    // 분노 단계 및 남은 이빨 수 시각화
    const remaining = state.remainingCount !== undefined
      ? state.remainingCount
      : (state.teethCount - state.pressedTeeth.length);
    updateCrocodileRage(state.rageLevel || 0, remaining);

    // 5초 시한폭탄 타이머 가동
    startClientTurnTimer(state.turnExpiresAt, state.turnTimeoutSec || 5, isMyTurn);

    if (isMyTurn) {
      window.soundFx.playTurn();
      window.soundFx.vibrate(25);
      if (els.turnAlertBox) els.turnAlertBox.className = 'text-center p-3 rounded-2xl bg-emerald-950/80 border-2 border-emerald-500 transition shadow-lg';
      if (els.currentTurnName) {
        els.currentTurnName.textContent = '👉 당신의 차례입니다!';
        els.currentTurnName.className = 'text-2xl font-black text-emerald-300 animate-bounce mt-0.5';
      }
      if (els.turnNoticeSub) {
        els.turnNoticeSub.textContent = '⚠️ 신중하게 이빨 하나를 터치하세요!';
        els.turnNoticeSub.className = 'text-xs text-emerald-200 font-bold mt-1';
      }
      if (els.gameGuideBanner) els.gameGuideBanner.textContent = '당신의 손에 운명이 걸려 있습니다!';
    } else {
      if (els.turnAlertBox) els.turnAlertBox.className = 'text-center p-3 rounded-2xl bg-slate-800 border border-slate-700 transition';
      if (els.currentTurnName) {
        els.currentTurnName.textContent = `${state.currentTurnNickname} 차례 대기 중...`;
        els.currentTurnName.className = 'text-xl font-bold text-amber-300 mt-0.5';
      }
      if (els.turnNoticeSub) {
        els.turnNoticeSub.textContent = '악어가 입을 벌리고 기다리고 있습니다...';
        els.turnNoticeSub.className = 'text-xs text-slate-400 font-semibold mt-1';
      }
      if (els.gameGuideBanner) els.gameGuideBanner.textContent = `${state.currentTurnNickname}님이 이빨을 고르고 있습니다.`;
    }

    // 이빨 렌더링
    els.teethGrid.innerHTML = '';
    for (let i = 0; i < state.teethCount; i++) {
      const isPressed = state.pressedTeeth.includes(i);
      const tooth = document.createElement('button');
      tooth.setAttribute('data-tooth-index', i);

      if (isPressed) {
        tooth.className = 'tooth-btn tooth-pressed flex items-center justify-center';
        tooth.innerHTML = '<span class="text-[10px] text-slate-500 font-bold">안전</span>';
        tooth.disabled = true;
      } else {
        tooth.className = `tooth-btn flex items-center justify-center font-black text-sm text-slate-700 ${
          isMyTurn ? 'cursor-pointer hover:brightness-105 active:scale-95' : 'cursor-not-allowed opacity-80'
        }`;
        tooth.innerHTML = '<span class="text-xs text-slate-400">🦷</span>';

        if (isMyTurn) {
          tooth.addEventListener('click', () => {
            // 이빨 하나를 선택하는 즉시 다른 이빨들 전체 연타 차단 (Lock)
            els.teethGrid.style.pointerEvents = 'none';

            window.soundFx.playClick();
            window.soundFx.vibrate(30);
            tooth.disabled = true;
            tooth.classList.add('tooth-pressed');

            console.log(`[Game] Tooth #${i} clicked, sending to server... Room: ${room.id}`);
            window.socketManager.sendGameAction(room.id, myToken, 'pressTooth', { toothIndex: i }, (res) => {
              console.log('[Game] sendGameAction response:', res);
              if (!res || !res.success) {
                // 실패 시 락 해제 및 원래대로 복구
                els.teethGrid.style.pointerEvents = 'auto';
                tooth.disabled = false;
                tooth.classList.remove('tooth-pressed');
                showAlert(res ? res.error : '이빨 조작에 실패했습니다.', { title: '조작 오류', icon: '⚠️' });
              } else if (res.data && res.data.room) {
                // 성공 시 화면 즉시 최신 상태로 갱신 (지연 방지)
                renderCrocodileGame(res.data.room);
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
        showAlert('카카오톡 공유 결과가 복사되었습니다!\n단톡방에 붙여넣기(Ctrl+V)하세요.', { title: '복사 완료', icon: '📋' });
      });
    };

    // 대기실로 리셋 버튼
    els.btnPlayAgain.onclick = () => {
      window.socketManager.resetToLobby(currentRoom.id, myToken, (res) => {
        if (!res || !res.success) showAlert(res ? res.error : '대기실 복귀에 실패했습니다.', { title: '복귀 실패', icon: '⚠️' });
      });
    };
  }

  // 소켓 재연결 시 방 자동 재참가 및 진행 상태 자동 동기화
  socket.on('connect', () => {
    if (currentRoom && myToken) {
      window.socketManager.rejoinRoom(currentRoom.id, myToken, (res) => {
        if (res && res.success && res.room) {
          console.log('[Socket] Rejoin room success:', currentRoom.id, res.room.status);
          currentRoom = res.room;
          if (res.room.status === 'PLAYING') {
            showView('game');
            try { renderCrocodileGame(res.room); } catch (e) {}
          } else if (res.room.status === 'LOBBY') {
            renderLobby(res.room);
            showView('lobby');
          }
        }
      });
    }
  });

  // 소켓 브로드캐스트 이벤트 리스너
  socket.on('roomUpdated', (room) => {
    clearClientTurnTimer();
    currentRoom = room;
    if (room.status === 'LOBBY') {
      renderLobby(room);
      showView('lobby');
    }
  });

  socket.on('gameStarted', (room) => {
    console.log('[Socket] gameStarted received:', room);
    currentRoom = room;
    showView('game');
    try {
      renderCrocodileGame(room);
    } catch (e) {
      console.error('[Error] renderCrocodileGame failed:', e);
    }
  });

  // 관전자 실시간 리액션 수신 (본인 발송분은 이미 로컬에서 낙관적 렌더링했으므로 중복 제외)
  socket.on('reactionReceived', (data) => {
    if (data.senderToken !== myToken) {
      spawnFloatingReaction(data);
    }
  });

  // 안전한 이빨을 눌렀을 때
  socket.on('toothPressed', (data) => {
    console.log('[Socket] toothPressed received:', data);
    currentRoom = data.room;
    showView('game');
    try {
      window.soundFx.playSafe();
    } catch (e) {
      console.warn('playSafe error:', e);
    }
    try {
      renderCrocodileGame(data.room);
    } catch (e) {
      console.error('[Error] renderCrocodileGame on toothPressed:', e);
    }
  });

  // 꽝 이빨을 누르거나 시간 초과로 악어가 쾅 물었을 때
  socket.on('gameFinished', (data) => {
    console.log('[Socket] gameFinished received:', data);
    clearClientTurnTimer();
    currentRoom = data.room;

    // 1. 악어 윗턱 닫힘 연출
    els.crocJawUpper.classList.add('croc-jaw-closed');

    // 2. 화면 전체 셰이크 & 붉은 경고
    els.mainContainer.classList.add('shake-effect');
    els.turnAlertBox.className = 'text-center p-3 rounded-2xl bg-rose-950 border-2 border-rose-500 shadow-xl';
    
    const reasonText = data.isTimeout ? '⏰ 시간 초과로' : '';
    els.currentTurnName.textContent = `💥 콰앙! ${data.loser.nickname}님이 ${reasonText} 물렸습니다!`;
    els.currentTurnName.className = 'text-2xl font-black text-rose-300 animate-pulse mt-0.5';
    els.turnNoticeSub.textContent = data.isTimeout ? '시간 내에 누르지 않아 악어가 화를 냈습니다!' : '악어가 입을 쾅 닫았습니다!';

    // 3. 묵직한 사운드 & 진동
    try {
      window.soundFx.playChomp();
    } catch (e) {}
    window.soundFx.vibrate([80, 50, 80, 50, 300]);

    // 4. 1.2초 후 결과 화면으로 전환
    setTimeout(() => {
      renderResult(data);
      showView('result');
    }, 1200);
  });

  socket.on('roomDestroyed', (data) => {
    clearClientTurnTimer();
    showAlert('방이 해산되었거나 방장이 퇴장했습니다.\n홈 화면으로 이동합니다.', {
      title: '방 해산 안내',
      icon: '🚪',
      danger: true
    }).then(() => {
      if (currentRoom) {
        clearSessionToken(currentRoom.id);
      }
      currentRoom = null;
      myToken = null;
      showView('home');
    });
  });
});
