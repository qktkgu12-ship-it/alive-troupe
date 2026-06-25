# 🎭 ALIVE 얼라이브 홈페이지 — 설치 & 배포 가이드

> 컴퓨터/코딩을 전혀 모르셔도 **순서대로 따라 하면** 완성됩니다.
> 막히는 부분이 있으면 그 단계 번호를 알려주세요.

전체 흐름은 이렇습니다:

```
1. Firebase 만들기 (회원·데이터·파일 저장소)   ← 우리 홈페이지의 "두뇌"
2. 내 컴퓨터에서 실행해 보기                    ← 잘 되는지 확인
3. GitHub에 코드 올리기                          ← 코드 보관 창고
4. Vercel로 인터넷에 배포                         ← 진짜 주소가 생김
5. 자동 배포 확인                                ← 앞으로 수정하면 자동 반영
```

---

## 1단계. Firebase 프로젝트 만들기

Firebase는 구글이 제공하는 무료 서비스로, **회원 관리·데이터·파일**을 담당합니다.

### 1-1. 프로젝트 생성
1. https://console.firebase.google.com 접속 → 구글 로그인 (`qktkgu12@gmail.com`)
2. **「프로젝트 만들기」** 클릭
3. 프로젝트 이름: `alive-troupe` (아무거나 가능) → 계속
4. "이 프로젝트에 Google 애널리틱스 사용 설정" → **꺼도 됩니다** → 계속/만들기
5. 잠시 기다리면 프로젝트 완성 → 「계속」

### 1-2. 웹 앱 등록 (설정값 받기)
1. 프로젝트 첫 화면 가운데 아이콘 중 **`</>` (웹)** 클릭
2. 앱 닉네임: `alive-web` 입력 → "Firebase 호스팅 설정"은 **체크 안 함** → 「앱 등록」
3. 화면에 이런 코드가 나옵니다 👇 (값은 사람마다 다름)

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSyB...................",
     authDomain: "alive-troupe.firebaseapp.com",
     projectId: "alive-troupe",
     storageBucket: "alive-troupe.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef......"
   };
   ```

4. 이 값들을 **메모장에 복사**해 두세요. (다음 단계에서 사용)

### 1-3. `.env.local` 파일에 설정값 붙여넣기
프로젝트 폴더 안에 있는 **`.env.local`** 파일을 메모장으로 열고,
위에서 복사한 값으로 아래처럼 채워 저장하세요. (따옴표 없이, = 뒤에 바로)

```
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyB...................
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=alive-troupe.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=alive-troupe
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=alive-troupe.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789012
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789012:web:abcdef......
NEXT_PUBLIC_ADMIN_EMAIL=qktkgu12@gmail.com
```

> 💡 `storageBucket` 값이 `xxxxx.firebasestorage.app` 으로 나오면 그대로 적으세요. (`appspot.com` 이든 `firebasestorage.app` 이든 화면에 나온 그대로)

### 1-4. 구글 로그인 켜기
1. 왼쪽 메뉴 **빌드 → Authentication** → 「시작하기」
2. **Sign-in method** 탭 → 제공업체 목록에서 **Google** 클릭
3. **사용 설정** 토글 ON → 지원 이메일에 본인 이메일 선택 → 「저장」

### 1-5. Firestore 데이터베이스 만들기
1. 왼쪽 메뉴 **빌드 → Firestore Database** → 「데이터베이스 만들기」
2. 위치: `asia-northeast3 (서울)` 추천 → 다음
3. 시작 모드: **프로덕션 모드**로 시작 → 「사용 설정」
4. 만들어지면 위쪽 **「규칙」** 탭 클릭
5. 기존 내용을 모두 지우고, 프로젝트의 **`firestore.rules`** 파일 내용을 전부 복사해 붙여넣기 → 「게시」

### 1-6. Storage(파일 저장소) 만들기 — 음원용
1. 왼쪽 메뉴 **빌드 → Storage** → 「시작하기」
2. 프로덕션 모드 → 위치는 그대로 → 완료
   - ⚠️ 만약 "요금제(Blaze) 업그레이드가 필요하다"고 나오면, 카드 등록이 필요할 수 있어요.
     무료 사용량(5GB 저장)이 넉넉해 **실제 요금은 거의 0원**이지만, 부담되면 이 단계는 건너뛰고
     음원 자료실만 나중에 켜도 됩니다. (다른 기능은 모두 정상 작동)
3. 만들어지면 **「규칙」** 탭 → 기존 내용 지우고 **`storage.rules`** 파일 내용 붙여넣기 → 「게시」

✅ 여기까지 하면 Firebase 준비 끝!

---

## 2단계. 내 컴퓨터에서 실행해 보기

1. 프로젝트 폴더에서 (이미 Claude가 열어둔 터미널에서) 아래를 실행:
   ```
   npm run dev
   ```
2. 브라우저에서 **http://localhost:3000** 접속
3. **「구글로 로그인」** → `qktkgu12@gmail.com` 으로 로그인
4. 이 이메일은 자동으로 **관리자**가 됩니다 → 바로 모든 기능 사용 가능!
5. 다른 사람이 가입하면 → 관리자 페이지의 **「승인 대기」**에 떠요 → 승인하면 정단원이 됩니다.

> 끝낼 땐 터미널에서 `Ctrl + C`.

---

## 3단계. GitHub에 코드 올리기

GitHub는 코드를 보관하는 무료 창고예요. Vercel이 여기서 코드를 가져가 배포합니다.

### 3-1. 계정 만들기
- https://github.com → 「Sign up」 → 이메일·비밀번호로 가입 (무료)

### 3-2. 새 저장소(repository) 만들기
1. 오른쪽 위 **+** → **New repository**
2. Repository name: `alive-troupe`
3. **Private**(비공개) 선택 추천
4. 나머지는 그대로 → **Create repository**
5. 다음 화면에 나오는 주소를 복사해 둡니다. 예: `https://github.com/내아이디/alive-troupe.git`

### 3-3. 코드 올리기
프로젝트 터미널에서 아래를 한 줄씩 실행하세요.
(`<주소>` 부분만 위에서 복사한 걸로 바꾸기)

```
git add .
git commit -m "ALIVE 홈페이지 첫 버전"
git branch -M main
git remote add origin <주소>
git push -u origin main
```
- 처음 push 할 때 GitHub 로그인 창이 뜨면 로그인하세요.

---

## 4단계. Vercel로 인터넷에 배포하기

### 4-1. 계정 & 연결
1. https://vercel.com → 「Sign Up」 → **Continue with GitHub** (깃허브로 가입)
2. 로그인되면 **「Add New… → Project」**
3. 방금 만든 `alive-troupe` 저장소 옆 **Import** 클릭

### 4-2. 환경변수 입력 (중요!)
Import 화면 아래 **Environment Variables** 칸에, `.env.local`에 적었던 7줄을
**이름(Key)** 과 **값(Value)** 으로 하나씩 추가하세요:

| Key | Value |
|---|---|
| NEXT_PUBLIC_FIREBASE_API_KEY | (내 값) |
| NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN | (내 값) |
| NEXT_PUBLIC_FIREBASE_PROJECT_ID | (내 값) |
| NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET | (내 값) |
| NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID | (내 값) |
| NEXT_PUBLIC_FIREBASE_APP_ID | (내 값) |
| NEXT_PUBLIC_ADMIN_EMAIL | qktkgu12@gmail.com |

→ **Deploy** 클릭 → 1~2분 기다리면 배포 완료! 🎉
→ `https://alive-troupe.vercel.app` 같은 주소가 생깁니다.

### 4-3. ⭐ 구글 로그인 허용 도메인 추가 (안 하면 로그인 안 됨)
1. Firebase 콘솔 → **Authentication → Settings(설정) → 승인된 도메인**
2. **「도메인 추가」** → Vercel 주소(`alive-troupe.vercel.app`)를 추가 → 저장
   - (`localhost`는 보통 이미 들어 있어요)

이제 인터넷 주소로 접속해서 구글 로그인이 됩니다!

---

## 5단계. 앞으로 수정 = 자동 배포

코드를 고친 뒤 터미널에서 아래만 하면, Vercel이 **자동으로** 새 버전을 배포합니다:

```
git add .
git commit -m "수정 내용 설명"
git push
```

1~2분 뒤 사이트에 반영돼요. 따로 할 일 없습니다. ✨

---

## 자주 묻는 것

- **회원 승인은 어디서?** 관리자로 로그인 → 상단 「관리자」 → 「승인 대기」에서 승인.
- **공연 색 바꾸기?** 「관리자」 → 「사이트·테마 설정」에서 현재 공연명·강조색 변경 → 전 단원에게 즉시 반영.
- **관리자를 더 추가?** 「관리자」 → 「회원 등급 관리」에서 해당 단원을 ‘관리자’로 변경.
- **로그인은 되는데 아무것도 안 보여요** → 아직 ‘승인 대기(준단원·게스트)’ 상태입니다. 관리자가 승인하면 보입니다.
- **음원 업로드가 안 돼요** → 1-6단계 Storage가 켜져 있는지 확인하세요.
```
