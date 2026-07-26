/* ===================================================================
   AI 图片生成器 — app.js
   三种工作流：单图生成 + 漫画分镜 + 气泡嵌字
   兼容 url 和 b64_json 两种响应格式
   多 API 站点适配（GrsAI / OpenAI / SiliconFlow / Gemini）
   =================================================================== */

// ─── 工具函数 ──────────────────────────────────────────────
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const icon = name => `<span class="ui-icon ui-icon-${name}" aria-hidden="true"></span>`;
const setIconText = (el, name, text) => { if (el) el.innerHTML = `${icon(name)} ${tr(text)}`; };
const APP_VERSION = "1.4.2";
const RELEASE_API_URL = "https://api.github.com/repos/2786886095/Langbai-api-image-Studio/releases/latest";
const UPDATE_CHECK_STATE_KEY = "ai_image_update_check_state_v1";
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function openFileInputOnce(input) {
  if (!input) return;
  const now = Date.now();
  // 这道锁本来是为了防止同一次物理点击被派发成两个 click 事件时重复弹出选择框——那种重复
  // 只会相隔几十毫秒。原来的锁定窗口是 900ms，太长了：原生文件选择框弹出本身可能有明显延迟
  // （尤其冷启动/慢磁盘），用户看不到反馈会不耐烦地再点一次，而这一下会被直接吞掉，表现为
  // "点了没反应"（嵌字模式批量上传区反馈过这个问题，因为那个入口本来就需要反复点着用）。
  // 400ms 依然能挡住真正意义上的"同一次点击触发两次"，但不会误伤用户几百毫秒后的正常重试点击。
  if (input._lastPickerOpenAt && now - input._lastPickerOpenAt < 400) return;
  input._lastPickerOpenAt = now;
  input.click();
  setTimeout(() => {
    if (input._lastPickerOpenAt === now) input._lastPickerOpenAt = 0;
  }, 500);
}

// ─── 国际化 ────────────────────────────────────────────────
const LANG_KEY = "ai_image_gen_language";
const SUPPORTED_LANGS = ["zh-CN", "zh-Hant", "en", "ja", "ko"];
const LANGUAGE_LOCALE_TAGS = { "zh-CN": "zh-CN", "zh-Hant": "zh-TW", en: "en-US", ja: "ja-JP", ko: "ko-KR" };
let currentLanguage = SUPPORTED_LANGS.includes(localStorage.getItem(LANG_KEY))
  ? localStorage.getItem(LANG_KEY)
  : "zh-CN";
let isApplyingLanguage = false;

const I18N = {
  "界面语言": { "zh-Hant": "介面語言", en: "Interface language", ja: "表示言語", ko: "화면 언어" },
  "查看生图记录": { "zh-Hant": "查看生圖記錄", en: "View generation history", ja: "生成履歴を表示", ko: "생성 기록 보기" },
  "设置": { "zh-Hant": "設定", en: "Settings", ja: "設定", ko: "설정" },
  "切换主题": { "zh-Hant": "切換主題", en: "Toggle theme", ja: "テーマ切替", ko: "테마 전환" },
  "关闭": { "zh-Hant": "關閉", en: "Close", ja: "閉じる", ko: "닫기" },
  "AI 图片生成器": { "zh-Hant": "AI 圖片生成器", en: "AI Image Generator", ja: "AI 画像生成", ko: "AI 이미지 생성기" },
  "单图生成 · 漫画分镜 · 气泡嵌字": { "zh-Hant": "單圖生成 · 漫畫分鏡 · 氣泡嵌字", en: "Single images · Comic panels · Speech bubbles", ja: "単体画像 · 漫画コマ · 吹き出し文字", ko: "단일 이미지 · 만화 컷 · 말풍선 문구" },
  "API 配置": { "zh-Hant": "API 設定", en: "API Settings", ja: "API 設定", ko: "API 설정" },
  "已保存的 API": { "zh-Hant": "已儲存的 API", en: "Saved APIs", ja: "保存済み API", ko: "저장된 API" },
  "— 手动填写 —": { "zh-Hant": "— 手動填寫 —", en: "— Manual entry —", ja: "— 手動入力 —", ko: "— 직접 입력 —" },
  "删除当前配置": { "zh-Hant": "刪除目前設定", en: "Delete current config", ja: "現在の設定を削除", ko: "현재 설정 삭제" },
  "API 地址": { "zh-Hant": "API 位址", en: "API URL", ja: "API URL", ko: "API 주소" },
  "https://grsai.dakka.com.cn": { "zh-Hant": "https://grsai.dakka.com.cn", en: "https://grsai.dakka.com.cn", ja: "https://grsai.dakka.com.cn", ko: "https://grsai.dakka.com.cn" },
  "推荐使用 GrsAI 第三方 API": { "zh-Hant": "推薦使用 GrsAI 第三方 API", en: "Recommended: GrsAI third-party API", ja: "おすすめ：GrsAI サードパーティ API", ko: "추천: GrsAI 서드파티 API" },
  "填入推荐地址": { "zh-Hant": "填入推薦位址", en: "Use recommended URL", ja: "推奨 URL を入力", ko: "추천 주소 입력" },
  "显示/隐藏": { "zh-Hant": "顯示/隱藏", en: "Show/Hide", ja: "表示/非表示", ko: "표시/숨김" },
  "模型": { "zh-Hant": "模型", en: "Model", ja: "モデル", ko: "모델" },
  "从 API 检测可用模型": { "zh-Hant": "從 API 偵測可用模型", en: "Detect available models from API", ja: "API から利用可能なモデルを検出", ko: "API에서 사용 가능한 모델 감지" },
  "检测": { "zh-Hant": "偵測", en: "Detect", ja: "検出", ko: "감지" },
  "检测中": { "zh-Hant": "偵測中", en: "Detecting", ja: "検出中", ko: "감지 중" },
  "浏览器 CORS 转发地址": { "zh-Hant": "瀏覽器 CORS 轉發位址", en: "Browser CORS proxy URL", ja: "ブラウザー CORS 転送 URL", ko: "브라우저 CORS 프록시 URL" },
  "(可选，用于解决浏览器 CORS)": { "zh-Hant": "（可選，用於解決瀏覽器 CORS）", en: "(optional, for browser CORS)", ja: "（任意、ブラウザー CORS 対策）", ko: "(선택, 브라우저 CORS 해결용)" },
  "保存配置": { "zh-Hant": "儲存設定", en: "Save config", ja: "設定を保存", ko: "설정 저장" },
  "单图模式": { "zh-Hant": "單圖模式", en: "Single Image", ja: "単体画像", ko: "단일 이미지" },
  "漫画分镜": { "zh-Hant": "漫畫分鏡", en: "Comic Panels", ja: "漫画コマ", ko: "만화 컷" },
  "全局提示词": { "zh-Hant": "全域提示詞", en: "Global Prompt", ja: "全体プロンプト", ko: "전역 프롬프트" },
  "全局提示词（注入所有分镜）": { "zh-Hant": "全域提示詞（注入所有分鏡）", en: "Global Prompt (applied to all panels)", ja: "全体プロンプト（全コマに適用）", ko: "전역 프롬프트(모든 컷에 적용)" },
  "提示词": { "zh-Hant": "提示詞", en: "Prompt", ja: "プロンプト", ko: "프롬프트" },
  "导入 txt": { "zh-Hant": "匯入 txt", en: "Import txt", ja: "txt を読み込み", ko: "txt 가져오기" },
  "导入 txt 文件作为参考（支持多选）": { "zh-Hant": "匯入 txt 檔作為參考（支援多選）", en: "Import txt files as references (multiple allowed)", ja: "参照用 txt ファイルを読み込み（複数可）", ko: "참고용 txt 파일 가져오기(복수 선택 가능)" },
  "描述你想生成的图片，越详细越好……\n\n例如：一只橘猫坐在窗台上，阳光透过纱帘洒在它身上，油画风格，暖色调": { "zh-Hant": "描述你想生成的圖片，越詳細越好……\n\n例如：一隻橘貓坐在窗台上，陽光透過紗簾灑在牠身上，油畫風格，暖色調", en: "Describe the image you want to generate. More detail is better...\n\nExample: an orange cat sitting on a windowsill, sunlight passing through sheer curtains, oil painting style, warm tones", ja: "生成したい画像をできるだけ詳しく説明してください……\n\n例：窓辺に座る茶トラ猫、薄いカーテン越しの陽光、油彩風、暖色調", ko: "생성하고 싶은 이미지를 자세히 설명하세요...\n\n예: 창가에 앉은 주황색 고양이, 얇은 커튼 사이로 들어오는 햇빛, 유화 스타일, 따뜻한 색감" },
  "全局参考图片": { "zh-Hant": "全域參考圖片", en: "Global Reference Images", ja: "全体参照画像", ko: "전역 참고 이미지" },
  "(可选，支持多选)": { "zh-Hant": "（可選，支援多選）", en: "(optional, multiple allowed)", ja: "（任意、複数可）", ko: "(선택, 복수 선택 가능)" },
  "点击或拖拽上传参考图（可多选）": { "zh-Hant": "點擊或拖曳上傳參考圖（可多選）", en: "Click or drag to upload reference images", ja: "クリックまたはドラッグで参照画像をアップロード", ko: "클릭하거나 드래그하여 참고 이미지 업로드" },
  "输出尺寸与参考图一致": { "zh-Hant": "輸出尺寸與參考圖一致", en: "Match output size to reference", ja: "出力サイズを参照画像に合わせる", ko: "출력 크기를 참고 이미지와 일치" },
  "全局分辨率": { "zh-Hant": "全域解析度", en: "Global Resolution", ja: "全体解像度", ko: "전역 해상도" },
  "横版 3:2": { "zh-Hant": "橫版 3:2", en: "Landscape 3:2", ja: "横長 3:2", ko: "가로 3:2" },
  "竖版 2:3": { "zh-Hant": "直版 2:3", en: "Portrait 2:3", ja: "縦長 2:3", ko: "세로 2:3" },
  "自定义": { "zh-Hant": "自訂", en: "Custom", ja: "カスタム", ko: "사용자 지정" },
  "宽": { "zh-Hant": "寬", en: "W", ja: "幅", ko: "너비" },
  "高": { "zh-Hant": "高", en: "H", ja: "高さ", ko: "높이" },
  "生成数量": { "zh-Hant": "生成數量", en: "Image Count", ja: "生成数", ko: "생성 수" },
  "1 张": { "zh-Hant": "1 張", en: "1 image", ja: "1 枚", ko: "1장" },
  "2 张": { "zh-Hant": "2 張", en: "2 images", ja: "2 枚", ko: "2장" },
  "3 张": { "zh-Hant": "3 張", en: "3 images", ja: "3 枚", ko: "3장" },
  "4 张": { "zh-Hant": "4 張", en: "4 images", ja: "4 枚", ko: "4장" },
  "依次生成": { "zh-Hant": "依序生成", en: "Generate sequentially", ja: "順番に生成", ko: "순차 생성" },
  "分镜列表": { "zh-Hant": "分鏡列表", en: "Panel List", ja: "コマ一覧", ko: "컷 목록" },
  "＋ 添加分镜": { "zh-Hant": "＋ 新增分鏡", en: "+ Add panel", ja: "＋ コマを追加", ko: "+ 컷 추가" },
  "清空": { "zh-Hant": "清空", en: "Clear", ja: "クリア", ko: "비우기" },
  "批量创建": { "zh-Hant": "批次建立", en: "Batch Create", ja: "一括作成", ko: "일괄 생성" },
  "设置要创建的分镜总数": { "zh-Hant": "設定要建立的分鏡總數", en: "Set total panels to create", ja: "作成するコマ数を設定", ko: "생성할 컷 수 설정" },
  "分镜数": { "zh-Hant": "分鏡數", en: "Panels", ja: "コマ数", ko: "컷 수" },
  "创建": { "zh-Hant": "建立", en: "Create", ja: "作成", ko: "생성" },
  "一键填写": { "zh-Hant": "一鍵填寫", en: "Auto Fill", ja: "自動入力", ko: "자동 입력" },
  "一键填写模板": { "zh-Hant": "一鍵填寫範本", en: "Auto-fill template", ja: "自動入力テンプレート", ko: "자동 입력 템플릿" },
  "输出分镜 N 的图片": { "zh-Hant": "輸出分鏡 N 的圖片", en: "Generate image for panel N", ja: "コマ N の画像を出力", ko: "컷 N 이미지 출력" },
  "参考图 N 加编号气泡": { "zh-Hant": "參考圖 N 加編號氣泡", en: "Add numbered bubble to reference N", ja: "参照画像 N に番号吹き出し", ko: "참고 이미지 N에 번호 말풍선" },
  "参考图 N 加文字编号": { "zh-Hant": "參考圖 N 加文字編號", en: "Add text number to reference N", ja: "参照画像 N に文字番号", ko: "참고 이미지 N에 텍스트 번호" },
  "自定义模板...": { "zh-Hant": "自訂範本...", en: "Custom template...", ja: "カスタムテンプレート...", ko: "사용자 템플릿..." },
  "填入": { "zh-Hant": "填入", en: "Fill", ja: "入力", ko: "채우기" },
  "分镜提示词": { "zh-Hant": "分鏡提示詞", en: "Panel Prompt", ja: "コマプロンプト", ko: "컷 프롬프트" },
  "分辨率": { "zh-Hant": "解析度", en: "Resolution", ja: "解像度", ko: "해상도" },
  "参考图": { "zh-Hant": "參考圖", en: "Reference", ja: "参照画像", ko: "참고 이미지" },
  "分镜提示词会拼接在全局提示词之后一起发送": { "zh-Hant": "分鏡提示詞會接在全域提示詞之後一起送出", en: "Panel prompts are appended after the global prompt", ja: "コマプロンプトは全体プロンプトの後に追加されます", ko: "컷 프롬프트는 전역 프롬프트 뒤에 함께 전송됩니다" },
  "全局提示词将拼接在每个分镜提示词前面": { "zh-Hant": "全域提示詞會接在每個分鏡提示詞前面", en: "Global prompt is prepended to every panel prompt", ja: "全体プロンプトは各コマプロンプトの前に追加されます", ko: "전역 프롬프트가 각 컷 프롬프트 앞에 추가됩니다" },
  "生成图片": { "zh-Hant": "生成圖片", en: "Generate Image", ja: "画像を生成", ko: "이미지 생성" },
  "批量生成全部分镜": { "zh-Hant": "批次生成全部分鏡", en: "Generate All Panels", ja: "全コマを一括生成", ko: "모든 컷 일괄 생성" },
  "生成中……": { "zh-Hant": "生成中……", en: "Generating...", ja: "生成中…", ko: "생성 중..." },
  "生成的图片将显示在这里": { "zh-Hant": "生成的圖片會顯示在這裡", en: "Generated images will appear here", ja: "生成画像はここに表示されます", ko: "생성된 이미지가 여기에 표시됩니다" },
  "在左侧输入提示词，点击「生成图片」开始": { "zh-Hant": "在左側輸入提示詞，點擊「生成圖片」開始", en: "Enter a prompt on the left and click Generate Image", ja: "左側にプロンプトを入力して「画像を生成」をクリック", ko: "왼쪽에 프롬프트를 입력하고 이미지 생성을 클릭하세요" },
  "正在生成中……": { "zh-Hant": "正在生成中……", en: "Generating...", ja: "生成中…", ko: "생성 중..." },
  "图片目录": { "zh-Hant": "圖片目錄", en: "Image Folder", ja: "画像フォルダー", ko: "이미지 폴더" },
  "ZIP 目录": { "zh-Hant": "ZIP 目錄", en: "ZIP Folder", ja: "ZIP フォルダー", ko: "ZIP 폴더" },
  "未选择": { "zh-Hant": "未選擇", en: "Not selected", ja: "未選択", ko: "선택 안 함" },
  "压缩包名称（可选）…": { "zh-Hant": "壓縮包名稱（可選）…", en: "ZIP name (optional)...", ja: "ZIP 名（任意）…", ko: "ZIP 이름(선택)..." },
  "打包下载 ZIP": { "zh-Hant": "打包下載 ZIP", en: "Download ZIP", ja: "ZIP でダウンロード", ko: "ZIP 다운로드" },
  "清空结果": { "zh-Hant": "清空結果", en: "Clear Results", ja: "結果をクリア", ko: "결과 비우기" },
  "准备下载…": { "zh-Hant": "準備下載…", en: "Preparing download...", ja: "ダウンロード準備中…", ko: "다운로드 준비 중..." },
  "下载路径": { "zh-Hant": "下載路徑", en: "Download Paths", ja: "ダウンロード先", ko: "다운로드 경로" },
  "安卓端会调用系统目录选择器并持久授权；电脑浏览器端使用浏览器默认下载目录。": { "zh-Hant": "Android 端會呼叫系統目錄選擇器並持久授權；電腦瀏覽器端使用瀏覽器預設下載目錄。", en: "Android uses the system folder picker with persistent permission. Desktop browsers use the default download folder.", ja: "Android ではシステムのフォルダー選択を使い、権限を保持します。PC ブラウザーでは既定のダウンロード先を使います。", ko: "Android는 시스템 폴더 선택기와 영구 권한을 사용합니다. PC 브라우저는 기본 다운로드 폴더를 사용합니다." },
  "图片保存目录": { "zh-Hant": "圖片儲存目錄", en: "Image save folder", ja: "画像保存先", ko: "이미지 저장 폴더" },
  "压缩包保存目录": { "zh-Hant": "壓縮包儲存目錄", en: "ZIP save folder", ja: "ZIP 保存先", ko: "ZIP 저장 폴더" },
  "选择目录": { "zh-Hant": "選擇目錄", en: "Choose Folder", ja: "フォルダー選択", ko: "폴더 선택" },
  "历史记录": { "zh-Hant": "歷史記錄", en: "History", ja: "履歴", ko: "기록" },
  "自动保存成功生成的图片记录": { "zh-Hant": "自動儲存成功生成的圖片記錄", en: "Automatically save successful generations", ja: "成功した生成画像を自動保存", ko: "성공한 생성 기록 자동 저장" },
  "最多保留记录数": { "zh-Hant": "最多保留記錄數", en: "Maximum records", ja: "最大保存件数", ko: "최대 기록 수" },
  "清空全部记录": { "zh-Hant": "清空全部記錄", en: "Clear All Records", ja: "全履歴を消去", ko: "모든 기록 삭제" },
  "生图记录": { "zh-Hant": "生圖記錄", en: "Generation History", ja: "生成履歴", ko: "생성 기록" },
  "项目元数据与图片均保存在本机，提示词默认折叠。": { "zh-Hant": "專案資料與圖片均保存在本機，提示詞預設摺疊。", en: "Project data and images stay on this device. Prompts are collapsed by default.", ja: "プロジェクトデータと画像は端末内に保存され、プロンプトは初期状態で折りたたまれます。", ko: "프로젝트 데이터와 이미지는 이 기기에 보관되며 프롬프트는 기본적으로 접혀 있습니다." },
  "搜索提示词 / 模型 / 日期": { "zh-Hant": "搜尋提示詞 / 模型 / 日期", en: "Search prompt / model / date", ja: "プロンプト / モデル / 日付を検索", ko: "프롬프트 / 모델 / 날짜 검색" },
  "刷新": { "zh-Hant": "重新整理", en: "Refresh", ja: "更新", ko: "새로고침" },
  "该分镜的专属提示词…": { "zh-Hant": "該分鏡的專屬提示詞…", en: "Prompt for this panel...", ja: "このコマ専用のプロンプト…", ko: "이 컷 전용 프롬프트..." },
  "上传参考图": { "zh-Hant": "上傳參考圖", en: "Upload reference", ja: "参照画像をアップロード", ko: "참고 이미지 업로드" },
  "清除": { "zh-Hant": "清除", en: "Remove", ja: "削除", ko: "제거" },
  "下载": { "zh-Hant": "下載", en: "Download", ja: "ダウンロード", ko: "다운로드" },
  "复制链接": { "zh-Hant": "複製連結", en: "Copy Link", ja: "リンクをコピー", ko: "링크 복사" },
  "重试": { "zh-Hant": "重試", en: "Retry", ja: "再試行", ko: "재시도" },
  "编辑重试": { "zh-Hant": "編輯重試", en: "Edit & Retry", ja: "編集して再試行", ko: "편집 후 재시도" },
  "一键重试": { "zh-Hant": "一鍵重試", en: "Retry", ja: "再試行", ko: "재시도" },
  "编辑后重试": { "zh-Hant": "編輯後重試", en: "Edit & Retry", ja: "編集して再試行", ko: "편집 후 재시도" },
  "失败": { "zh-Hant": "失敗", en: "Failed", ja: "失敗", ko: "실패" },
  "图片加载中…": { "zh-Hant": "圖片載入中…", en: "Loading image...", ja: "画像を読み込み中…", ko: "이미지 로딩 중..." },
  "图片链接暂时无法预览": { "zh-Hant": "圖片連結暫時無法預覽", en: "Image link cannot be previewed right now", ja: "画像リンクは現在プレビューできません", ko: "이미지 링크를 현재 미리 볼 수 없습니다" },
  "恢复": { "zh-Hant": "恢復", en: "Restore", ja: "復元", ko: "복원" },
  "暂无生图记录": { "zh-Hant": "暫無生圖記錄", en: "No generation history", ja: "生成履歴はありません", ko: "생성 기록 없음" },
  "展开全部": { "zh-Hant": "展開全部", en: "Expand", ja: "すべて展開", ko: "전체 펼치기" },
  "收起": { "zh-Hant": "收起", en: "Collapse", ja: "閉じる", ko: "접기" },
  "自动重试": { "zh-Hant": "自動重試", en: "Auto Retry", ja: "自動再試行", ko: "자동 재시도" },
  "全局重试次数": { "zh-Hant": "全域重試次數", en: "Global retries", ja: "全体再試行回数", ko: "전역 재시도 횟수" },
  "只有 HTTP 400 会自动重试；0 表示不自动重试。分镜里的重试次数可覆盖这里。": { "zh-Hant": "只有 HTTP 400 會自動重試；0 表示不自動重試。分鏡裡的重試次數可覆蓋這裡。", en: "Only HTTP 400 retries automatically. 0 disables auto retry. Per-panel retries override this.", ja: "HTTP 400 のみ自動再試行します。0 は自動再試行なし。各コマの回数で上書きできます。", ko: "HTTP 400만 자동 재시도됩니다. 0은 자동 재시도 없음입니다. 컷별 횟수로 덮어쓸 수 있습니다." },
  "重试": { "zh-Hant": "重試", en: "Retry", ja: "再試行", ko: "재시도" },
  "继承": { "zh-Hant": "繼承", en: "Inherit", ja: "継承", ko: "상속" },
  "该分镜自动重试次数，留空继承全局": { "zh-Hant": "該分鏡自動重試次數，留空繼承全域", en: "Auto retries for this panel. Leave empty to inherit global.", ja: "このコマの自動再試行回数。空欄なら全体設定を使用。", ko: "이 컷의 자동 재시도 횟수입니다. 비워두면 전역 설정을 따릅니다." },
  "重新加载图片": { "zh-Hant": "重新載入圖片", en: "Reload image", ja: "画像を再読み込み", ko: "이미지 다시 로드" },
  "图片重新加载中…": { "zh-Hant": "圖片重新載入中…", en: "Reloading image...", ja: "画像を再読み込み中…", ko: "이미지 다시 로드 중..." },
  "重载失败，仍无法预览": { "zh-Hant": "重載失敗，仍無法預覽", en: "Reload failed. Preview is still unavailable.", ja: "再読み込みに失敗しました。まだプレビューできません。", ko: "다시 로드하지 못했습니다. 아직 미리 볼 수 없습니다." },
  "漫画项目": { "zh-Hant": "漫畫專案", en: "Comic Project", ja: "漫画プロジェクト", ko: "만화 프로젝트" },
  "恢复项目": { "zh-Hant": "恢復專案", en: "Restore Project", ja: "プロジェクトを復元", ko: "프로젝트 복원" },
  "无提示词": { "zh-Hant": "無提示詞", en: "No prompt", ja: "プロンプトなし", ko: "프롬프트 없음" },
  "请先填写 API 地址，再设为默认": { "zh-Hant": "請先填寫 API 位址，再設為預設", en: "Enter the API URL before setting it as default.", ja: "API URL を入力してから既定に設定してください。", ko: "API URL을 입력한 후 기본값으로 설정하세요." },
  "这些参考图已经导入过了": { "zh-Hant": "這些參考圖已經匯入過了", en: "These reference images have already been imported.", ja: "これらの参照画像はすでに読み込まれています。", ko: "이 참고 이미지는 이미 가져왔습니다." },
  "当前尺寸无效，宽高需要在 64 到 4096 之间": { "zh-Hant": "目前尺寸無效，寬高需介於 64 到 4096", en: "Invalid size. Width and height must be between 64 and 4096.", ja: "サイズが無効です。幅と高さは 64～4096 にしてください。", ko: "크기가 올바르지 않습니다. 너비와 높이는 64~4096이어야 합니다." },
  "请先添加分镜": { "zh-Hant": "請先新增分鏡", en: "Add a panel first.", ja: "先にコマを追加してください。", ko: "먼저 컷을 추가하세요." },
  "请先批量上传图片": { "zh-Hant": "請先批次上傳圖片", en: "Bulk-upload images first.", ja: "先に画像を一括アップロードしてください。", ko: "먼저 이미지를 일괄 업로드하세요." },
  "模型列表获取失败，已加载常用模型": { "zh-Hant": "模型清單取得失敗，已載入常用模型", en: "Could not fetch the model list. Common models were loaded instead.", ja: "モデル一覧を取得できなかったため、一般的なモデルを読み込みました。", ko: "모델 목록을 가져오지 못해 일반 모델을 불러왔습니다." },
  "检测端点存在，但 API Key 无效或无权限。已加载常用模型供选择": { "zh-Hant": "端點可用，但 API Key 無效或無權限。已載入常用模型供選擇", en: "The endpoint is reachable, but the API key is invalid or unauthorized. Common models were loaded.", ja: "エンドポイントには接続できましたが、API Key が無効か権限がありません。一般的なモデルを読み込みました。", ko: "엔드포인트에는 연결됐지만 API Key가 잘못됐거나 권한이 없습니다. 일반 모델을 불러왔습니다." },
  "该 API 不开放模型列表，已加载常用模型": { "zh-Hant": "此 API 未開放模型清單，已載入常用模型", en: "This API does not expose a model list. Common models were loaded.", ja: "この API はモデル一覧を公開していないため、一般的なモデルを読み込みました。", ko: "이 API는 모델 목록을 제공하지 않아 일반 모델을 불러왔습니다." },
  "请先填写 API 地址和 Key": { "zh-Hant": "請先填寫 API 位址與 Key", en: "Enter the API URL and key first.", ja: "API URL と Key を入力してください。", ko: "API URL과 Key를 먼저 입력하세요." },
  "未知平台，已加载通用模型列表": { "zh-Hant": "未知平台，已載入通用模型清單", en: "Unknown provider. A generic model list was loaded.", ja: "不明なプロバイダーのため、汎用モデル一覧を読み込みました。", ko: "알 수 없는 공급자라 범용 모델 목록을 불러왔습니다." },
  "正在检测模型列表…": { "zh-Hant": "正在偵測模型清單…", en: "Detecting models...", ja: "モデルを検出中…", ko: "모델을 감지하는 중..." },
  "该平台不支持模型列表查询，已加载常用模型": { "zh-Hant": "此平台不支援模型清單查詢，已載入常用模型", en: "This provider does not support model discovery. Common models were loaded.", ja: "このプロバイダーはモデル検索に対応していないため、一般的なモデルを読み込みました。", ko: "이 공급자는 모델 조회를 지원하지 않아 일반 모델을 불러왔습니다." },
  "请先配置 API 地址": { "zh-Hant": "請先設定 API 位址", en: "Configure an API URL first.", ja: "先に API URL を設定してください。", ko: "먼저 API URL을 설정하세요." },
  "请先配置 API Key": { "zh-Hant": "請先設定 API Key", en: "Configure an API key first.", ja: "先に API Key を設定してください。", ko: "먼저 API Key를 설정하세요." },
  "请输入提示词或导入 txt 文件": { "zh-Hant": "請輸入提示詞或匯入 txt 檔案", en: "Enter a prompt or import a txt file.", ja: "プロンプトを入力するか txt ファイルを読み込んでください。", ko: "프롬프트를 입력하거나 txt 파일을 가져오세요." },
  "请至少为一个分镜填写提示词": { "zh-Hant": "請至少為一個分鏡填寫提示詞", en: "Enter a prompt for at least one panel.", ja: "少なくとも 1 コマにプロンプトを入力してください。", ko: "최소 한 컷에 프롬프트를 입력하세요." },
  "请至少给一张图片上传图片并填写气泡文字": { "zh-Hant": "請至少上傳一張圖片並填寫氣泡文字", en: "Upload at least one image and enter its bubble text.", ja: "少なくとも 1 枚の画像をアップロードし、吹き出しの文字を入力してください。", ko: "이미지를 한 장 이상 업로드하고 말풍선 문구를 입력하세요." },
  "重试前请先填写提示词": { "zh-Hant": "重試前請先填寫提示詞", en: "Enter a prompt before retrying.", ja: "再試行する前にプロンプトを入力してください。", ko: "재시도 전에 프롬프트를 입력하세요." },
  "已从历史记录恢复到结果区": { "zh-Hant": "已從歷史記錄恢復到結果區", en: "Restored from history to the results area.", ja: "履歴から結果エリアへ復元しました。", ko: "기록에서 결과 영역으로 복원했습니다." },
  "历史记录已清空": { "zh-Hant": "歷史記錄已清空", en: "History cleared.", ja: "履歴を消去しました。", ko: "기록을 모두 지웠습니다." },
  "已从后台返回，页面状态已刷新": { "zh-Hant": "已從背景返回，頁面狀態已重新整理", en: "Returned to the app and refreshed its state.", ja: "アプリに戻り、状態を更新しました。", ko: "앱으로 돌아와 상태를 새로고침했습니다." },
  "当前不是原生软件环境，浏览器会使用默认下载目录": { "zh-Hant": "目前不是原生軟體環境，瀏覽器會使用預設下載目錄", en: "This is not a native app shell. The browser will use its default download folder.", ja: "ネイティブアプリ環境ではないため、ブラウザーの既定ダウンロード先を使用します。", ko: "네이티브 앱 환경이 아니므로 브라우저 기본 다운로드 폴더를 사용합니다." },
  "正在打开安装目录选择器…": { "zh-Hant": "正在開啟安裝目錄選擇器…", en: "Opening the installation folder picker...", ja: "インストール先の選択画面を開いています…", ko: "설치 폴더 선택기를 여는 중..." },
  "链接已复制": { "zh-Hant": "連結已複製", en: "Link copied.", ja: "リンクをコピーしました。", ko: "링크를 복사했습니다." },
  "参考图导入失败": { "zh-Hant": "參考圖匯入失敗", en: "Reference image import failed.", ja: "参照画像の読み込みに失敗しました。", ko: "참고 이미지 가져오기에 실패했습니다." },
  "分镜参考图读取失败": { "zh-Hant": "分鏡參考圖讀取失敗", en: "Could not read the panel reference image.", ja: "コマの参照画像を読み込めませんでした。", ko: "컷 참고 이미지를 읽지 못했습니다." },
  "图片读取失败": { "zh-Hant": "圖片讀取失敗", en: "Could not read the image.", ja: "画像を読み込めませんでした。", ko: "이미지를 읽지 못했습니다." },
  "批量导入图片失败": { "zh-Hant": "批次匯入圖片失敗", en: "Bulk image import failed.", ja: "画像の一括読み込みに失敗しました。", ko: "이미지 일괄 가져오기에 실패했습니다." },
  "历史图片加载失败": { "zh-Hant": "歷史圖片載入失敗", en: "Could not load the history image.", ja: "履歴画像を読み込めませんでした。", ko: "기록 이미지를 불러오지 못했습니다." },
  "正在重试生成…": { "zh-Hant": "正在重試生成…", en: "Retrying generation...", ja: "生成を再試行中…", ko: "생성을 재시도하는 중..." },
  "未知日期": { "zh-Hant": "未知日期", en: "Unknown date", ja: "日付不明", ko: "날짜 알 수 없음" },
};

const I18N_PATTERNS = [
  [/^分镜 (\d+)$/, "分镜 {1}", { "zh-Hant": "分鏡 {1}", en: "Panel {1}", ja: "コマ {1}", ko: "컷 {1}" }],
  [/^图片 (\d+)$/, "图片 {1}", { "zh-Hant": "圖片 {1}", en: "Image {1}", ja: "画像 {1}", ko: "이미지 {1}" }],
  [/^参考图 (\d+): (.+)$/, "参考图 {1}: {2}", { "zh-Hant": "參考圖 {1}: {2}", en: "Reference {1}: {2}", ja: "参照画像 {1}: {2}", ko: "참고 이미지 {1}: {2}" }],
  [/^已加载 (\d+) 个模型，点击选择$/, "已加载 {1} 个模型，点击选择", { "zh-Hant": "已載入 {1} 個模型，點擊選擇", en: "{1} models loaded. Click to choose.", ja: "{1} 個のモデルを読み込みました。クリックして選択", ko: "{1}개 모델 로드됨. 클릭하여 선택" }],
  [/^已加载 (\d+) 个生图模型，点击选择$/, "已加载 {1} 个生图模型，点击选择", { "zh-Hant": "已載入 {1} 個生圖模型，點擊選擇", en: "{1} image models loaded. Click to choose.", ja: "{1} 個の画像モデルを読み込みました。クリックして選択", ko: "{1}개 이미지 모델 로드됨. 클릭하여 선택" }],
  [/^已切换: (.+)$/, "已切换: {1}", { "zh-Hant": "已切換：{1}", en: "Switched to: {1}", ja: "切り替えました：{1}", ko: "전환됨: {1}" }],
  [/^已保存: (.+?)( ✅)?$/, "已保存: {1}{2}", { "zh-Hant": "已儲存：{1}{2}", en: "Saved: {1}{2}", ja: "保存しました：{1}{2}", ko: "저장됨: {1}{2}" }],
  [/^已设为默认 API: (.+)$/, "已设为默认 API: {1}", { "zh-Hant": "已設為預設 API：{1}", en: "Default API set to: {1}", ja: "既定の API に設定：{1}", ko: "기본 API로 설정됨: {1}" }],
  [/^已删除: (.+)$/, "已删除: {1}", { "zh-Hant": "已刪除：{1}", en: "Deleted: {1}", ja: "削除しました：{1}", ko: "삭제됨: {1}" }],
  [/^已导入 (\d+) 个文本参考 ✅$/, "已导入 {1} 个文本参考 ✅", { "zh-Hant": "已匯入 {1} 個文字參考 ✅", en: "Imported {1} text references ✅", ja: "{1} 件のテキスト参照を読み込みました ✅", ko: "텍스트 참고 {1}개를 가져왔습니다 ✅" }],
  [/^已添加 (\d+) 张参考图（共 (\d+) 张）$/, "已添加 {1} 张参考图（共 {2} 张）", { "zh-Hant": "已新增 {1} 張參考圖（共 {2} 張）", en: "Added {1} reference images ({2} total).", ja: "参照画像を {1} 枚追加しました（合計 {2} 枚）。", ko: "참고 이미지 {1}장을 추가했습니다(총 {2}장)." }],
  [/^已保存常用尺寸: (.+)$/, "已保存常用尺寸: {1}", { "zh-Hant": "已儲存常用尺寸：{1}", en: "Saved size preset: {1}", ja: "サイズを保存しました：{1}", ko: "크기 프리셋 저장됨: {1}" }],
  [/^已应用尺寸: (.+)$/, "已应用尺寸: {1}", { "zh-Hant": "已套用尺寸：{1}", en: "Applied size: {1}", ja: "サイズを適用しました：{1}", ko: "크기 적용됨: {1}" }],
  [/^已删除常用尺寸: (.+)$/, "已删除常用尺寸: {1}", { "zh-Hant": "已刪除常用尺寸：{1}", en: "Deleted size preset: {1}", ja: "保存済みサイズを削除しました：{1}", ko: "크기 프리셋 삭제됨: {1}" }],
  [/^分镜 (\d+) 已绑定参考图$/, "分镜 {1} 已绑定参考图", { "zh-Hant": "分鏡 {1} 已綁定參考圖", en: "Reference image attached to panel {1}.", ja: "コマ {1} に参照画像を設定しました。", ko: "컷 {1}에 참고 이미지를 연결했습니다." }],
  [/^当前已经是 (\d+) 个分镜$/, "当前已经是 {1} 个分镜", { "zh-Hant": "目前已經是 {1} 個分鏡", en: "There are already {1} panels.", ja: "すでに {1} コマあります。", ko: "이미 {1}개 컷이 있습니다." }],
  [/^已创建 (\d+) 个分镜$/, "已创建 {1} 个分镜", { "zh-Hant": "已建立 {1} 個分鏡", en: "Created {1} panels.", ja: "{1} コマを作成しました。", ko: "컷 {1}개를 만들었습니다." }],
  [/^已调整为 (\d+) 个分镜$/, "已调整为 {1} 个分镜", { "zh-Hant": "已調整為 {1} 個分鏡", en: "Adjusted to {1} panels.", ja: "{1} コマに調整しました。", ko: "컷 {1}개로 조정했습니다." }],
  [/^正在读取 (\d+) 张分镜参考图…$/, "正在读取 {1} 张分镜参考图…", { "zh-Hant": "正在讀取 {1} 張分鏡參考圖…", en: "Reading {1} panel reference images...", ja: "コマの参照画像を {1} 枚読み込み中…", ko: "컷 참고 이미지 {1}장을 읽는 중..." }],
  [/^正在读取 (\d+) 张图片…$/, "正在读取 {1} 张图片…", { "zh-Hant": "正在讀取 {1} 張圖片…", en: "Reading {1} images...", ja: "画像を {1} 枚読み込み中…", ko: "이미지 {1}장을 읽는 중..." }],
  [/^GrsAI 生成中… (\d+)%$/, "GrsAI 生成中… {1}%", { "zh-Hant": "GrsAI 生成中… {1}%", en: "GrsAI generating... {1}%", ja: "GrsAI 生成中… {1}%", ko: "GrsAI 생성 중... {1}%" }],
  [/^已加载 (\d+) 个生图模型$/, "已加载 {1} 个生图模型", { "zh-Hant": "已載入 {1} 個生圖模型", en: "Loaded {1} image models.", ja: "画像モデルを {1} 個読み込みました。", ko: "이미지 모델 {1}개를 불러왔습니다." }],
  [/^(.+) 返回 (.+)，正在进行第 (\d+)\/(\d+) 轮自动重试…$/, "{1} 返回 {2}，正在进行第 {3}/{4} 轮自动重试…", { "zh-Hant": "{1} 回傳 {2}，正在進行第 {3}/{4} 輪自動重試…", en: "{1} returned {2}. Automatic retry {3}/{4}...", ja: "{1} が {2} を返しました。自動再試行 {3}/{4}…", ko: "{1}에서 {2}을 반환했습니다. 자동 재시도 {3}/{4}..." }],
  [/^(\d+) 张成功，(\d+) 张失败$/, "{1} 张成功，{2} 张失败", { "zh-Hant": "{1} 張成功，{2} 張失敗", en: "{1} succeeded, {2} failed.", ja: "{1} 枚成功、{2} 枚失敗。", ko: "{1}장 성공, {2}장 실패." }],
  [/^(\d+) 张全部生成完成$/, "{1} 张全部生成完成", { "zh-Hant": "{1} 張全部生成完成", en: "All {1} images generated.", ja: "{1} 枚すべて生成しました。", ko: "이미지 {1}장을 모두 생성했습니다." }],
  [/^完成：(\d+) 成功 \/ (\d+) 失败$/, "完成：{1} 成功 / {2} 失败", { "zh-Hant": "完成：{1} 成功 / {2} 失敗", en: "Done: {1} succeeded / {2} failed.", ja: "完了：成功 {1} / 失敗 {2}", ko: "완료: {1} 성공 / {2} 실패" }],
  [/^全部 (\d+) 个分镜生成完成！$/, "全部 {1} 个分镜生成完成！", { "zh-Hant": "全部 {1} 個分鏡生成完成！", en: "All {1} panels generated!", ja: "全 {1} コマを生成しました！", ko: "컷 {1}개를 모두 생성했습니다!" }],
  [/^全部 (\d+) 张图片生成完成！$/, "全部 {1} 张图片生成完成！", { "zh-Hant": "全部 {1} 張圖片生成完成！", en: "All {1} images generated!", ja: "全 {1} 枚の画像を生成しました！", ko: "이미지 {1}장을 모두 생성했습니다!" }],
  [/^生成失败: (.+)$/, "生成失败: {1}", { "zh-Hant": "生成失敗：{1}", en: "Generation failed: {1}", ja: "生成に失敗しました：{1}", ko: "생성 실패: {1}" }],
  [/^批量生成失败: (.+)$/, "批量生成失败: {1}", { "zh-Hant": "批次生成失敗：{1}", en: "Batch generation failed: {1}", ja: "一括生成に失敗しました：{1}", ko: "일괄 생성 실패: {1}" }],
  [/^第 (\d+)\/(\d+) 次自动重试（(.+)）$/, "第 {1}/{2} 次自动重试（{3}）", { "zh-Hant": "第 {1}/{2} 次自動重試（{3}）", en: "Automatic retry {1}/{2} ({3})", ja: "自動再試行 {1}/{2}（{3}）", ko: "자동 재시도 {1}/{2} ({3})" }],
  [/^第 (\d+)\/(\d+) 次自动重试$/, "第 {1}/{2} 次自动重试", { "zh-Hant": "第 {1}/{2} 次自動重試", en: "Automatic retry {1}/{2}", ja: "自動再試行 {1}/{2}", ko: "자동 재시도 {1}/{2}" }],
  [/^目录选择失败: (.+)$/, "目录选择失败: {1}", { "zh-Hant": "目錄選擇失敗：{1}", en: "Folder selection failed: {1}", ja: "フォルダー選択に失敗しました：{1}", ko: "폴더 선택 실패: {1}" }],
  [/^下载失败: (.+)$/, "下载失败: {1}", { "zh-Hant": "下載失敗：{1}", en: "Download failed: {1}", ja: "ダウンロードに失敗しました：{1}", ko: "다운로드 실패: {1}" }],
];

const I18N_REVERSE = new Map();
for (const [source, translations] of Object.entries(I18N)) {
  I18N_REVERSE.set(source, source);
  for (const value of Object.values(translations)) I18N_REVERSE.set(value, source);
}

const CLEAN_LOCALES = {
  "zh-CN": {
    langZh: "简体", langHant: "繁体", langEn: "EN", langJa: "日本語", langKo: "한국어",
    appTitle: "AI 图片生成器", subtitle: "单图生成 · 漫画分镜 · 气泡嵌字",
    web: "Web/PWA", desktop: "桌面", android: "安卓",
    create: "创作", panels: "分镜", history: "历史", export: "导出", settings: "设置",
    apiSettings: "API 配置", apiProvider: "API 类型", officialApi: "官方 API", opencodexApi: "OpenCodex 本地生图", grsaiImageApi: "GrsAI 生图 API", customApi: "自定义 API",
    opencodexHint: "使用本机 OpenCodex 的 ChatGPT 登录转发生图；本地占位密钥不会发送给 OpenAI，实际额度类型由 ChatGPT 上游决定。",
    opencodexPanelTitle: "OpenCodex 本地图片代理", opencodexPanelHint: "复用本机 ChatGPT/Codex 或 Google Antigravity 登录；仅连接 127.0.0.1，不使用电脑端代理。", openCodexModel: "本地生图模型", openCodexModelHint: "GPT Image 2 适合通用生成；Nano Banana 2 擅长多参考图、文字和语义编辑。", opencodexQuality: "质量偏好", opencodexQualityHint: "私有额度上游实测固定为中等质量，其他档位不会生效。", opencodexBackground: "背景", opencodexBackgroundHint: "gpt-image-2 仅发送自动或不透明；不会发送透明背景。", openCodexAspectRatio: "画面比例", openCodexAspectRatioHint: "只能选择 Nano Banana 2 官方支持的画面比例。", openCodexImageSize: "分辨率档位", openCodexImageSizeHint: "512/1K 最多并发 5，2K 最多 3，4K 固定单任务。", opencodexFacts: "JSON 图片协议 · GPT Image 2 · 中等质量 · 约 157 万像素 · 并发 5", opencodexCapability: "实测输出约 157 万像素、最长边 2172、质量固定为中等；软件会把尺寸比例写入提示词，并以实际返回尺寸为准。", openCodexNanoFacts: "JSON 图片协议 · Nano Banana 2 · 当前最多并发 {concurrency} · 单次超时 620 秒", openCodexNanoCapability: "支持最多 8 张客户端参考图、文字渲染和语义编辑；比例与档位是请求目标，结果以实际图片为准。", opencodexHealthCheck: "检测本地服务", opencodexHealthIdle: "尚未检测", opencodexHealthChecking: "正在连接 OpenCodex…", opencodexHealthReady: "本地服务可用 · OpenCodex {version}", opencodexHealthFailed: "本地服务不可用：{reason}", openInpaint: "局部重绘", inpaintRequiresNano: "局部重绘需要选择 Nano Banana 2", inpaintRequiresGptImage2: "局部重绘仅支持 OpenCodex 或官方 OpenAI 的 gpt-image-2", inpaintTitle: "局部重绘", inpaintDisclosure: "局部重绘仅支持两个 gpt-image-2 入口。", inpaintOfficialDisclosure: "官方 OpenAI gpt-image-2 使用原生 mask；软件仍会在本地保护蒙版外像素。", inpaintOpenCodexDisclosure: "OpenCodex gpt-image-2 生成语义补丁；软件只在本地蒙版内合成。", inpaintChooseSource: "选择原图", inpaintNoSource: "尚未选择图片", inpaintPromptLabel: "修改内容", inpaintGenerate: "生成候选补丁", inpaintApply: "应用并加入结果", inpaintInitial: "先选择原图，再涂抹要修改的区域。", inpaintNeedSource: "请先选择原图", inpaintNeedMask: "请先涂抹要修改的区域", inpaintNeedPrompt: "请输入修改内容", inpaintGenerating: "正在生成候选补丁 {done}/{total}…", inpaintApplied: "局部重绘结果已加入结果列表", inpaintCandidateFailed: "候选 {index} 失败：{reason}", inpaintRequestedActual: "请求：{requested} · 实际：{actual}",
    savedApis: "已保存的 API", manualApi: "手动填写", setDefaultApi: "默认", defaultApi: "默认 API",
    apiProviderHint: "推荐生图中转网站：https://grsai.com/zh；请在浏览器打开管理，软件内不跳转网站。",
    apiUrl: "API 地址", grsaiEndpoint: "https://grsai.dakka.com.cn/v1/api/generate", grsaiWebsite: "推荐生图中转网站：https://grsai.com/zh", useGrsaiEndpoint: "填入 GrsAI 地址",
    officialPanelTitle: "官方图像参数", officialPanelHint: "仅发送给 OpenAI 官方 Image API，并随当前官方 API 配置保存。", officialQuality: "输出质量", officialQualityHint: "自动会平衡速度与细节；低适合草稿，中适合日常，高适合最终成图。", optionAuto: "自动", optionLow: "低", optionMedium: "中", optionHigh: "高", officialBackground: "背景", officialBackgroundHint: "透明背景适合贴纸与素材；gpt-image-2 暂不支持透明。", optionOpaque: "不透明", optionTransparent: "透明", officialOutputFormat: "输出格式", officialOutputFormatHint: "PNG 无损；JPEG 更快；WebP 通常体积更小且支持透明。", officialCompression: "压缩质量", officialCompressionHint: "仅用于 JPEG/WebP；数值越低文件越小，细节损失越明显。", officialModeration: "内容审核强度", officialModerationHint: "自动使用标准过滤；低会减少限制，但仍受官方内容政策约束。", officialInputFidelity: "参考图保真度", officialInputFidelityHint: "仅编辑/参考图生效；高保真更重视人物、风格和细节一致性，成本可能更高。", officialCapabilityDefault: "选择模型后会显示该模型的尺寸、透明背景和参考图能力。", officialCapabilityGptImage2: "gpt-image-2 支持符合约束的自定义尺寸；暂不支持透明背景；参考图固定使用高保真。", officialCapabilityMini: "gpt-image-1-mini 支持标准三种尺寸与透明背景，但不支持调整参考图保真度。", officialCapabilityLegacy: "该模型支持标准三种尺寸；透明背景请使用 PNG/WebP；参考图可选择低/高保真。", grsaiPanelTitle: "GrsAI 中转协议", grsaiPanelHint: "使用独立的 generate/result 任务协议；OpenAI 官方质量、格式和背景参数不会发送到这里。", grsaiNodeHint: "国内节点 · 异步任务轮询 · 返回图片 URL", grsaiWebsiteLabel: "推荐管理网站：https://grsai.com/zh", customPanelTitle: "通用兼容模式", customPanelHint: "按 OpenAI 兼容的 generations/edits 请求发送基础参数；不会附加 OpenAI 官方或 GrsAI 专属字段。", grsaiRetryTitle: "GrsAI 提交重试", officialModelsDetected: "已检测到 {count} 个可用的 OpenAI 官方生图模型", officialModelsFallback: "无法读取官方模型列表，已加载内置官方生图模型：{reason}", officialModelsNoMatch: "当前 Key 的模型列表中没有识别到官方生图模型，已加载内置列表", officialModelAuthFailed: "OpenAI API Key 无效、无权限或项目未获模型访问权限",
    model: "模型", detect: "检测", proxy: "浏览器 CORS 转发地址", saveConfig: "保存配置",
    modelChoicesPlaceholder: "从检测到的模型中选择…",
    desktopProxyTitle: "电脑端网络代理", desktopProxyMode: "代理模式", desktopProxyCustomUrl: "自定义代理地址",
    desktopProxyHttp: "HTTP 127.0.0.1:7890", desktopProxySocks: "SOCKS5 127.0.0.1:10808", desktopProxyDirect: "直连", desktopProxyCustom: "自定义",
    testDesktopProxy: "测试代理", desktopProxyHint: "默认使用 HTTP 127.0.0.1:7890；纯浏览器端请使用系统/浏览器代理或 api-proxy.js。",
    desktopProxyBrowserOnly: "浏览器端不能由网页切换 HTTP/SOCKS5 代理；请使用系统/浏览器代理或 api-proxy.js。",
    desktopProxyTesting: "正在测试代理…", desktopProxyOk: "代理测试成功：{mode} {target}", desktopProxyFailed: "代理测试失败：{reason}",
    desktopProxyInvalid: "自定义代理地址无效，仅支持 http://host:port、https://host:port、socks5://host:port",
    connectApi: "接入 API", apiDetect: "检测", apiConnected: "API 已接入", apiDisconnected: "API 未接入",
    apiConnectHint: "点击接入 API 后填写地址、Key 和模型",
    singleMode: "单图模式", comicMode: "漫画分镜", captionMode: "嵌字模式", prompt: "提示词", globalPrompt: "全局提示词",
    globalPromptComic: "全局提示词（注入所有分镜）", globalPromptCaption: "全局提示词（注入所有图片）", importTxt: "导入 txt",
    promptPlaceholder: "描述你想生成的图片，越详细越好……\n\n例如：一只橘猫坐在窗台上，阳光透过纱帘洒在它身上，油画风格，暖色调",
    globalRefs: "全局参考图片（可选，支持多选）", uploadRefs: "点击或拖拽上传参考图（可多选）",
    uploadRefsClickOnly: "点击上传参考图（可多选）",
    captionUploadHint: "点击或拖拽批量上传图片（自动按文件名顺序逐张生成，不会一次性打包发送）",
    captionUploadHintClickOnly: "点击批量上传图片（自动按文件名顺序逐张生成，不会一次性打包发送）",
    generateAllCaptions: "批量生成全部图片",
    matchSize: "输出尺寸与参考图一致", resolution: "全局分辨率", landscape: "横版 3:2", portrait: "竖版 2:3",
    custom: "自定义", width: "宽", height: "高", savedSizes: "常用尺寸", saveSizePreset: "保存尺寸", deleteSizePreset: "删除常用尺寸", imageCount: "生成数量", sequential: "依次生成",
    sequentialHint: "不勾选：按当前 API 的并发上限批量生成；勾选：逐张依次生成",
    panelList: "分镜列表", captionList: "嵌字列表", addPanel: "添加分镜", clear: "清空", batchCreate: "批量创建", panelCount: "分镜数",
    createBtn: "创建", autoFill: "一键填写", fill: "填入", panelPrompt: "分镜提示词", retry: "重试",
    bulkPrompts: "批量输入提示词", bulkComicTitle: "批量输入分镜提示词", bulkCaptionTitle: "批量输入嵌字提示词",
    bulkComicHint: "每行一条，按顺序对应分镜；空行也会占据一个位置。", bulkCaptionHint: "每行一条，按图片名称顺序对应；空行也会占据一个位置。",
    bulkPromptPlaceholder: "第 1 条提示词\n第 2 条提示词\n第 3 条提示词", bulkPromptCount: "输入 {lines} 行 / 当前 {rows} {unit}",
    applyBulkPrompts: "按顺序填入", cancel: "取消", noBulkPrompts: "请至少输入一条非空提示词", noCaptionImages: "请先批量上传图片",
    tooManyCaptionPrompts: "提示词有 {lines} 条，但当前只有 {rows} 张图片。请删除多出的提示词或继续上传图片。",
    overwriteBulkPrompts: "对应位置已有内容，确定按批量输入覆盖吗？", bulkPromptsApplied: "已按顺序填写 {count} 条提示词", bulkPromptsRemaining: "，另有 {count} {unit}保持不变",
    reference: "参考图", generateImage: "生成图片", generateAll: "批量生成全部分镜", cancelGeneration: "取消生成",
    imageFolder: "图片目录", zipFolder: "ZIP 目录", notSelected: "未选择", zipName: "压缩包名称（可选）…", projectExportName: "项目 / 文件夹名称（可选）…",
    downloadZip: "打包下载 ZIP", saveToFolder: "保存到文件夹", savingToFolder: "保存中……", folderSaved: "已保存到文件夹", clearResults: "清空结果", emptyTitle: "生成的图片将显示在这里",
    emptyHint: "在左侧输入提示词，点击「生成图片」开始", downloadPaths: "下载路径",
    imageSaveFolder: "图片保存目录", zipSaveFolder: "压缩包保存目录", chooseFolder: "选择目录", imageAskEveryTime: "每次保存图片时询问路径", zipAskEveryTime: "每次保存 ZIP 时询问路径", pathModeHint: "未勾选时使用上方保存目录；勾选后每次保存都会重新选择一次目录。", textSelectAll: "全选", textCut: "剪切", textCopy: "复制", textPaste: "粘贴",
    historyTitle: "生图记录", historyHint: "漫画与嵌字任务按项目保存，提示词默认折叠；项目元数据与图片均保存在本机。",
    searchHistory: "搜索提示词 / 模型 / 日期", refresh: "刷新", autoSaveHistory: "自动保存成功生成的图片记录",
    maxRecords: "最多保留记录数", clearAllHistory: "清空全部记录", imageCacheTitle: "图片临时缓存", cacheRetentionDays: "自动清理天数", cacheRetentionHint: "生成成功后立即缓存在应用内部，避免中转图片链接过期；只有打包 ZIP 或保存到文件夹时才会写入所选目录。", clearGeneratedCache: "立即清理缓存", cacheAutoHint: "缓存会在应用启动和生成新图片时自动清理。", cacheCleared: "已清理 {count} 张缓存图片", cacheCleanupFailed: "缓存清理失败：{reason}", autoRetry: "自动重试", globalRetries: "全局重试次数",
    retryHint: "通用 API 只有 HTTP 400 会自动重试；0 表示不自动重试。分镜里的重试次数可覆盖这里。",
    grsaiSubmit504Retries: "GrsAI 提交 504 重试次数", grsaiSubmit504Interval: "GrsAI 提交 504 间隔（秒）",
    grsaiSubmit504Hint: "仅用于 GrsAI 首次提交返回 HTTP 504；自动重提可能偶尔生成重复图片。次数设为 0 可关闭。",
    grsaiSubmit504Waiting: "GrsAI 提交返回 HTTP 504，{seconds} 秒后进行第 {retryIndex}/{maxRetries} 次重试…",
    grsaiSubmit504Exhausted: "HTTP 504：GrsAI 提交请求仍然超时，已完成 {count} 次自动重试。任务可能已经提交，请先在 GrsAI 后台确认，再决定是否手动重试。",
    restoreProject: "恢复项目", downloadProject: "导出项目", viewPrompts: "查看提示词与分镜",
    globalPromptLabel: "全局提示词", panelLabel: "分镜", noPrompt: "无提示词", comicProject: "漫画项目", captionProject: "嵌字项目", captionImageCol: "图片", captionBubbleCol: "气泡文字",
    noHistory: "暂无生图记录", expand: "展开全部", collapse: "收起",
    noImagesToExport: "没有可导出的图片", exportOpenedHistory: "当前结果为空，已打开历史记录，可在项目卡片点击「导出项目」", packaging: "打包中……", preparingZip: "准备打包 ZIP…",
    collectingImages: "收集图片", compressing: "生成 ZIP", zipSaved: "ZIP 已保存", exportFailed: "导出失败",
    download: "下载", copyLink: "复制链接", editRetry: "编辑重试", reloadImage: "重新加载图片", stopCardRetry: "取消",
    failReason: "失败原因", retryFailedAll: "全部失败重试", cancelRetryFailedAll: "取消全部重试", cancellingRetryFailedAll: "正在取消全部重试", failedRetryCount: "失败后追加次数", failedRetryCountHint: "每张先执行 1 次；失败后最多追加 N 次。填写 10 表示最多共 11 次。", noFailedToRetry: "没有可重试的失败分镜",
    retryFailedAllStarted: "正在重试 {count} 个失败项", retryFailedAllCancelled: "已取消全部失败重试，可再次点击重试", retryQueued: "等待重试（队列第 {position} 个）", retryQueuedHint: "尚未发送请求，前面的任务完成后会自动开始", retryQueuedRound: "准备第 {attempt}/{maxAttempts} 次重试", bulkRetryRound: "全部重试第 {attempt}/{maxAttempts} 次", enqueueRemainingFailed: "补充剩余失败", remainingFailedAdded: "已补充 {count} 个遗漏的失败项", noRemainingFailed: "没有遗漏的失败项，当前队列已经完整",
    softwareUpdate: "软件更新", currentVersion: "当前版本", latestVersion: "最新版本", updateAsset: "更新资源", notChecked: "未检测", releaseNotesPlaceholder: "检查更新后显示 GitHub Release 说明",
    checkUpdates: "检查更新", downloadUpdate: "下载更新包", installUpdate: "下载并安装", openReleasePage: "打开发布页",
    updateInitialHint: "可从 GitHub Releases 检测新版。Windows 可校验后覆盖安装；macOS 会下载并打开更新包；安卓和 iOS 会用系统浏览器打开发布页。",
    checkingUpdates: "正在检查更新…", noUpdate: "已是最新版", updateAvailable: "发现新版本 {version}",
    updateCheckFailed: "检查更新失败", noUpdateAsset: "没有找到适合当前平台的更新包",
    downloadingUpdate: "正在下载更新包…", updateDownloaded: "更新包已下载: {path}",
    updateInstallStarted: "更新安装已启动。Windows 会关闭当前程序并覆盖安装目录。",
    updateOpenRelease: "当前环境不能直接覆盖安装，已打开更新包下载链接。",
    updateOpenGithubMobile: "安卓版请在 GitHub 发布页下载安装包，已为你打开该页面。",
    updateNowPrompt: "是否立即更新？",
    installDir: "安装目录",
    installDirHint: "留空表示更新时自动使用当前程序所在目录；如果想让更新覆盖到别的位置（比如旧版本装在其它盘），可以手动选择。",
    resetInstallDir: "恢复自动",
    installDirUpdated: "安装目录已更新，下次更新会安装到这个目录",
    installDirResetDone: "已恢复为自动跟随当前程序位置"
  },
  "zh-Hant": {
    langZh: "簡體", langHant: "繁體", langEn: "EN", langJa: "日本語", langKo: "한국어",
    appTitle: "AI 圖片生成器", subtitle: "單圖生成 · 漫畫分鏡 · 氣泡嵌字",
    web: "Web/PWA", desktop: "桌面", android: "安卓",
    create: "創作", panels: "分鏡", history: "歷史", export: "匯出", settings: "設定",
    apiSettings: "API 設定", apiProvider: "API 類型", officialApi: "官方 API", opencodexApi: "OpenCodex 本機生圖", grsaiImageApi: "GrsAI 生圖 API", customApi: "自訂 API",
    opencodexHint: "使用本機 OpenCodex 的 ChatGPT 登入轉發生圖；本機佔位密鑰不會傳送給 OpenAI，實際額度類型由 ChatGPT 上游決定。",
    opencodexPanelTitle: "OpenCodex 本機圖片代理", opencodexPanelHint: "重用本機 ChatGPT/Codex 或 Google Antigravity 登入；僅連線 127.0.0.1，不使用電腦端代理。", openCodexModel: "本機生圖模型", openCodexModelHint: "GPT Image 2 適合通用生成；Nano Banana 2 擅長多參考圖、文字與語意編輯。", opencodexQuality: "品質偏好", opencodexQualityHint: "私有額度上游實測固定為中等品質，其他檔位不會生效。", opencodexBackground: "背景", opencodexBackgroundHint: "gpt-image-2 僅傳送自動或不透明；不會傳送透明背景。", openCodexAspectRatio: "畫面比例", openCodexAspectRatioHint: "只能選擇 Nano Banana 2 官方支援的畫面比例。", openCodexImageSize: "解析度檔位", openCodexImageSizeHint: "512/1K 最多並行 5，2K 最多 3，4K 固定單任務。", opencodexFacts: "JSON 圖片協議 · GPT Image 2 · 中等品質 · 約 157 萬像素 · 並行 5", opencodexCapability: "實測輸出約 157 萬像素、最長邊 2172、品質固定為中等；軟體會將尺寸比例寫入提示詞，並以實際回傳尺寸為準。", openCodexNanoFacts: "JSON 圖片協議 · Nano Banana 2 · 目前最多並行 {concurrency} · 單次逾時 620 秒", openCodexNanoCapability: "支援最多 8 張客戶端參考圖、文字渲染與語意編輯；比例與檔位是請求目標，以實際圖片為準。", opencodexHealthCheck: "偵測本機服務", opencodexHealthIdle: "尚未偵測", opencodexHealthChecking: "正在連線 OpenCodex…", opencodexHealthReady: "本機服務可用 · OpenCodex {version}", opencodexHealthFailed: "本機服務無法使用：{reason}", openInpaint: "局部重繪", inpaintRequiresNano: "局部重繪需要選擇 Nano Banana 2", inpaintTitle: "局部重繪", inpaintDisclosure: "Nano Banana 2 產生語意補丁，軟體只在蒙版內本機合成；這不是上游原生 mask 重繪。", inpaintChooseSource: "選擇原圖", inpaintNoSource: "尚未選擇圖片", inpaintPromptLabel: "修改內容", inpaintGenerate: "產生候選補丁", inpaintApply: "套用並加入結果", inpaintInitial: "先選擇原圖，再塗抹要修改的區域。", inpaintNeedSource: "請先選擇原圖", inpaintNeedMask: "請先塗抹要修改的區域", inpaintNeedPrompt: "請輸入修改內容", inpaintGenerating: "正在產生候選補丁 {done}/{total}…", inpaintApplied: "局部重繪結果已加入結果清單", inpaintCandidateFailed: "候選 {index} 失敗：{reason}", inpaintRequestedActual: "請求：{requested} · 實際：{actual}",
    savedApis: "已儲存的 API", manualApi: "手動填寫", setDefaultApi: "預設", defaultApi: "預設 API",
    apiProviderHint: "推薦生圖中轉網站：https://grsai.com/zh；請在瀏覽器開啟管理，軟體內不跳轉網站。",
    apiUrl: "API 位址", grsaiEndpoint: "https://grsai.dakka.com.cn/v1/api/generate", grsaiWebsite: "推薦生圖中轉網站：https://grsai.com/zh", useGrsaiEndpoint: "填入 GrsAI 位址",
    officialPanelTitle: "官方圖像參數", officialPanelHint: "僅傳送至 OpenAI 官方 Image API，並隨目前的官方 API 設定儲存。", officialQuality: "輸出品質", officialQualityHint: "自動會平衡速度與細節；低適合草稿，中適合日常，高適合最終成圖。", optionAuto: "自動", optionLow: "低", optionMedium: "中", optionHigh: "高", officialBackground: "背景", officialBackgroundHint: "透明背景適合貼圖與素材；gpt-image-2 暫不支援透明。", optionOpaque: "不透明", optionTransparent: "透明", officialOutputFormat: "輸出格式", officialOutputFormatHint: "PNG 無損；JPEG 更快；WebP 通常較小且支援透明。", officialCompression: "壓縮品質", officialCompressionHint: "僅用於 JPEG/WebP；數值越低檔案越小，細節損失越明顯。", officialModeration: "內容審核強度", officialModerationHint: "自動使用標準過濾；低會減少限制，但仍受官方內容政策約束。", officialInputFidelity: "參考圖保真度", officialInputFidelityHint: "僅編輯/參考圖生效；高保真更重視人物、風格與細節一致性，成本可能更高。", officialCapabilityDefault: "選擇模型後會顯示該模型的尺寸、透明背景與參考圖能力。", officialCapabilityGptImage2: "gpt-image-2 支援符合約束的自訂尺寸；暫不支援透明背景；參考圖固定使用高保真。", officialCapabilityMini: "gpt-image-1-mini 支援標準三種尺寸與透明背景，但不支援調整參考圖保真度。", officialCapabilityLegacy: "此模型支援標準三種尺寸；透明背景請使用 PNG/WebP；參考圖可選擇低/高保真。", grsaiPanelTitle: "GrsAI 中轉協議", grsaiPanelHint: "使用獨立的 generate/result 任務協議；OpenAI 官方品質、格式與背景參數不會傳送到這裡。", grsaiNodeHint: "國內節點 · 非同步任務輪詢 · 回傳圖片 URL", grsaiWebsiteLabel: "推薦管理網站：https://grsai.com/zh", customPanelTitle: "通用相容模式", customPanelHint: "依 OpenAI 相容的 generations/edits 請求傳送基礎參數；不會附加 OpenAI 官方或 GrsAI 專屬欄位。", grsaiRetryTitle: "GrsAI 提交重試", officialModelsDetected: "已偵測到 {count} 個可用的 OpenAI 官方生圖模型", officialModelsFallback: "無法讀取官方模型清單，已載入內建官方生圖模型：{reason}", officialModelsNoMatch: "目前 Key 的模型清單中未辨識到官方生圖模型，已載入內建清單", officialModelAuthFailed: "OpenAI API Key 無效、無權限或專案尚未取得模型存取權",
    model: "模型", detect: "偵測", proxy: "瀏覽器 CORS 轉發位址", saveConfig: "儲存設定",
    modelChoicesPlaceholder: "從偵測到的模型中選擇…",
    desktopProxyTitle: "桌面端網路代理", desktopProxyMode: "代理模式", desktopProxyCustomUrl: "自訂代理位址",
    desktopProxyHttp: "HTTP 127.0.0.1:7890", desktopProxySocks: "SOCKS5 127.0.0.1:10808", desktopProxyDirect: "直連", desktopProxyCustom: "自訂",
    testDesktopProxy: "測試代理", desktopProxyHint: "預設使用 HTTP 127.0.0.1:7890；純瀏覽器端請使用系統/瀏覽器代理或 api-proxy.js。",
    desktopProxyBrowserOnly: "瀏覽器端不能由網頁切換 HTTP/SOCKS5 代理；請使用系統/瀏覽器代理或 api-proxy.js。",
    desktopProxyTesting: "正在測試代理…", desktopProxyOk: "代理測試成功：{mode} {target}", desktopProxyFailed: "代理測試失敗：{reason}",
    desktopProxyInvalid: "自訂代理位址無效，僅支援 http://host:port、https://host:port、socks5://host:port",
    connectApi: "接入 API", apiDetect: "偵測", apiConnected: "API 已接入", apiDisconnected: "API 未接入",
    apiConnectHint: "點擊接入 API 後填寫位址、Key 和模型",
    singleMode: "單圖模式", comicMode: "漫畫分鏡", captionMode: "嵌字模式", prompt: "提示詞", globalPrompt: "全域提示詞",
    globalPromptComic: "全域提示詞（套用到所有分鏡）", globalPromptCaption: "全域提示詞（套用到所有圖片）", importTxt: "匯入 txt",
    promptPlaceholder: "描述你想生成的圖片，越詳細越好……\n\n例如：一隻橘貓坐在窗台上，陽光透過紗簾灑在牠身上，油畫風格，暖色調",
    globalRefs: "全域參考圖片（可選，支援多選）", uploadRefs: "點擊或拖曳上傳參考圖（可多選）",
    uploadRefsClickOnly: "點擊上傳參考圖（可多選）",
    captionUploadHint: "點擊或拖曳批次上傳圖片（自動依檔名順序逐張生成，不會一次性打包傳送）",
    captionUploadHintClickOnly: "點擊批次上傳圖片（自動依檔名順序逐張生成，不會一次性打包傳送）",
    generateAllCaptions: "批次生成全部圖片",
    matchSize: "輸出尺寸與參考圖一致", resolution: "全域解析度", landscape: "橫版 3:2", portrait: "直版 2:3",
    custom: "自訂", width: "寬", height: "高", savedSizes: "常用尺寸", saveSizePreset: "儲存尺寸", deleteSizePreset: "刪除常用尺寸", imageCount: "生成數量", sequential: "依序生成",
    sequentialHint: "不勾選：依目前 API 的並發上限批次生成；勾選：逐張依序生成",
    panelList: "分鏡列表", captionList: "嵌字列表", addPanel: "新增分鏡", clear: "清空", batchCreate: "批次建立", panelCount: "分鏡數",
    createBtn: "建立", autoFill: "一鍵填寫", fill: "填入", panelPrompt: "分鏡提示詞", retry: "重試",
    bulkPrompts: "批次輸入提示詞", bulkComicTitle: "批次輸入分鏡提示詞", bulkCaptionTitle: "批次輸入嵌字提示詞",
    bulkComicHint: "每行一條，依序對應分鏡；空行也會保留一個位置。", bulkCaptionHint: "每行一條，依圖片名稱順序對應；空行也會保留一個位置。",
    bulkPromptPlaceholder: "第 1 條提示詞\n第 2 條提示詞\n第 3 條提示詞", bulkPromptCount: "輸入 {lines} 行 / 目前 {rows} {unit}",
    applyBulkPrompts: "依序填入", cancel: "取消", noBulkPrompts: "請至少輸入一條非空提示詞", noCaptionImages: "請先批次上傳圖片",
    tooManyCaptionPrompts: "提示詞有 {lines} 條，但目前只有 {rows} 張圖片。請刪除多出的提示詞或繼續上傳圖片。",
    overwriteBulkPrompts: "對應位置已有內容，確定依批次輸入覆蓋嗎？", bulkPromptsApplied: "已依序填寫 {count} 條提示詞", bulkPromptsRemaining: "，另有 {count} {unit}保持不變",
    reference: "參考圖", generateImage: "生成圖片", generateAll: "批次生成全部分鏡", cancelGeneration: "取消生成",
    imageFolder: "圖片目錄", zipFolder: "ZIP 目錄", notSelected: "未選擇", zipName: "壓縮包名稱（可選）…", projectExportName: "專案 / 資料夾名稱（可選）…",
    downloadZip: "打包下載 ZIP", saveToFolder: "儲存到資料夾", savingToFolder: "儲存中……", folderSaved: "已儲存到資料夾", clearResults: "清空結果", emptyTitle: "生成的圖片將顯示在這裡",
    emptyHint: "在左側輸入提示詞，點擊「生成圖片」開始", downloadPaths: "下載路徑",
    imageSaveFolder: "圖片儲存目錄", zipSaveFolder: "壓縮包儲存目錄", chooseFolder: "選擇目錄", imageAskEveryTime: "每次儲存圖片時詢問路徑", zipAskEveryTime: "每次儲存 ZIP 時詢問路徑", pathModeHint: "未勾選時使用上方儲存目錄；勾選後每次儲存都會重新選擇一次目錄。", textSelectAll: "全選", textCut: "剪下", textCopy: "複製", textPaste: "貼上",
    historyTitle: "生圖記錄", historyHint: "漫畫與嵌字工作會按專案保存，提示詞預設摺疊；專案資料與圖片均保存在本機。",
    searchHistory: "搜尋提示詞 / 模型 / 日期", refresh: "重新整理", autoSaveHistory: "自動保存成功生成的圖片記錄",
    maxRecords: "最多保留記錄數", clearAllHistory: "清空全部記錄", imageCacheTitle: "圖片暫存快取", cacheRetentionDays: "自動清理天數", cacheRetentionHint: "生成成功後會立即快取在應用程式內，避免中轉圖片連結過期；只有打包 ZIP 或儲存到資料夾時才會寫入所選目錄。", clearGeneratedCache: "立即清理快取", cacheAutoHint: "快取會在應用程式啟動和生成新圖片時自動清理。", cacheCleared: "已清理 {count} 張快取圖片", cacheCleanupFailed: "快取清理失敗：{reason}", autoRetry: "自動重試", globalRetries: "全域重試次數",
    retryHint: "通用 API 只有 HTTP 400 會自動重試；0 表示不自動重試。分鏡中的重試次數可覆蓋這裡。",
    grsaiSubmit504Retries: "GrsAI 提交 504 重試次數", grsaiSubmit504Interval: "GrsAI 提交 504 間隔（秒）",
    grsaiSubmit504Hint: "僅用於 GrsAI 首次提交回傳 HTTP 504；自動重提偶爾可能生成重複圖片。次數設為 0 可關閉。",
    grsaiSubmit504Waiting: "GrsAI 提交回傳 HTTP 504，{seconds} 秒後進行第 {retryIndex}/{maxRetries} 次重試…",
    grsaiSubmit504Exhausted: "HTTP 504：GrsAI 提交請求仍然逾時，已完成 {count} 次自動重試。任務可能已提交，請先在 GrsAI 後台確認，再決定是否手動重試。",
    restoreProject: "恢復專案", downloadProject: "匯出專案", viewPrompts: "查看提示詞與分鏡",
    globalPromptLabel: "全域提示詞", panelLabel: "分鏡", noPrompt: "無提示詞", comicProject: "漫畫專案", captionProject: "嵌字專案", captionImageCol: "圖片", captionBubbleCol: "氣泡文字",
    noHistory: "暫無生圖記錄", expand: "展開全部", collapse: "收起",
    noImagesToExport: "沒有可匯出的圖片", exportOpenedHistory: "目前結果為空，已開啟歷史記錄，可在專案卡片點擊「匯出專案」", packaging: "打包中……", preparingZip: "準備打包 ZIP…",
    collectingImages: "收集圖片", compressing: "生成 ZIP", zipSaved: "ZIP 已保存", exportFailed: "匯出失敗",
    download: "下載", copyLink: "複製連結", editRetry: "編輯重試", reloadImage: "重新載入圖片", stopCardRetry: "取消",
    failReason: "失敗原因", retryFailedAll: "全部失敗重試", cancelRetryFailedAll: "取消全部重試", cancellingRetryFailedAll: "正在取消全部重試", failedRetryCount: "失敗後追加次數", failedRetryCountHint: "每張先執行 1 次；失敗後最多追加 N 次。填寫 10 表示最多共 11 次。", noFailedToRetry: "沒有可重試的失敗分鏡",
    retryFailedAllStarted: "正在重試 {count} 個失敗項目", retryFailedAllCancelled: "已取消全部失敗重試，可再次點擊重試", retryQueued: "等待重試（佇列第 {position} 個）", retryQueuedHint: "尚未送出請求，前面的工作完成後會自動開始", retryQueuedRound: "準備第 {attempt}/{maxAttempts} 次重試", bulkRetryRound: "全部重試第 {attempt}/{maxAttempts} 次", enqueueRemainingFailed: "補充剩餘失敗", remainingFailedAdded: "已補充 {count} 個遺漏的失敗項目", noRemainingFailed: "沒有遺漏的失敗項目，目前佇列已完整",
    softwareUpdate: "軟體更新", currentVersion: "目前版本", latestVersion: "最新版本", updateAsset: "更新資源", notChecked: "未檢測", releaseNotesPlaceholder: "檢查更新後顯示 GitHub Release 說明",
    checkUpdates: "檢查更新", downloadUpdate: "下載更新包", installUpdate: "下載並安裝", openReleasePage: "開啟發布頁",
    updateInitialHint: "可從 GitHub Releases 檢測新版。Windows 可在驗證後覆蓋安裝；macOS 會下載並開啟更新包；Android 與 iOS 會以系統瀏覽器開啟發布頁。",
    checkingUpdates: "正在檢查更新…", noUpdate: "已是最新版本", updateAvailable: "發現新版本 {version}",
    updateCheckFailed: "檢查更新失敗", noUpdateAsset: "沒有找到適合目前平台的更新包",
    downloadingUpdate: "正在下載更新包…", updateDownloaded: "更新包已下載: {path}",
    updateInstallStarted: "更新安裝已啟動。Windows 會關閉目前程式並覆蓋安裝目錄。",
    updateOpenRelease: "目前環境不能直接覆蓋安裝，已開啟更新包下載連結。",
    updateOpenGithubMobile: "Android 版請在 GitHub 發布頁下載安裝包，已為你開啟該頁面。",
    updateNowPrompt: "是否立即更新？",
    installDir: "安裝目錄",
    installDirHint: "留空表示更新時自動使用目前程式所在目錄；如果想讓更新覆蓋到別的位置（比如舊版本裝在其他磁碟），可以手動選擇。",
    resetInstallDir: "恢復自動",
    installDirUpdated: "安裝目錄已更新，下次更新會安裝到這個目錄",
    installDirResetDone: "已恢復為自動跟隨目前程式位置"
  },
  en: {
    langZh: "简体", langHant: "繁體", langEn: "EN", langJa: "日本語", langKo: "한국어",
    appTitle: "AI Image Generator", subtitle: "Single images · Comic panels · Speech bubbles",
    web: "Web/PWA", desktop: "Desktop", android: "Android",
    create: "Create", panels: "Panels", history: "History", export: "Export", settings: "Settings",
    apiSettings: "API Settings", apiProvider: "API Type", officialApi: "Official API", opencodexApi: "OpenCodex Local Images", grsaiImageApi: "GrsAI Image API", customApi: "Custom API",
    opencodexHint: "Routes images through the local OpenCodex ChatGPT login. The placeholder key is never sent to OpenAI; ChatGPT determines the actual quota category.",
    opencodexPanelTitle: "OpenCodex local image proxy", opencodexPanelHint: "Reuses the local ChatGPT/Codex or Google Antigravity login. Connects only to 127.0.0.1 and bypasses the desktop proxy.", openCodexModel: "Local image model", openCodexModelHint: "GPT Image 2 is general purpose; Nano Banana 2 excels at multi-reference, text, and semantic editing.", opencodexQuality: "Quality preference", opencodexQualityHint: "The private quota upstream was measured at fixed Medium quality; the other tiers have no effect.", opencodexBackground: "Background", opencodexBackgroundHint: "gpt-image-2 sends only Auto or Opaque; Transparent is never sent.", openCodexAspectRatio: "Aspect ratio", openCodexAspectRatioHint: "Only official Nano Banana 2 aspect ratios are available.", openCodexImageSize: "Resolution tier", openCodexImageSizeHint: "512/1K: up to 5 concurrent; 2K: 3; 4K: one task.", opencodexFacts: "JSON image protocol · GPT Image 2 · Medium · about 1.57 MP · concurrency 5", opencodexCapability: "Measured output is about 1.57 MP with a 2172 px longest edge and fixed Medium quality. The requested ratio is added to the prompt; decoded dimensions are authoritative.", openCodexNanoFacts: "JSON image protocol · Nano Banana 2 · up to {concurrency} concurrent · 620-second timeout", openCodexNanoCapability: "Supports up to 8 client-side references, text rendering, and semantic edits. Ratio and tier are request targets; the decoded image is authoritative.", opencodexHealthCheck: "Test local service", opencodexHealthIdle: "Not checked", opencodexHealthChecking: "Connecting to OpenCodex…", opencodexHealthReady: "Local service ready · OpenCodex {version}", opencodexHealthFailed: "Local service unavailable: {reason}", openInpaint: "Local inpaint", inpaintRequiresNano: "Local inpaint requires Nano Banana 2", inpaintTitle: "Local inpaint", inpaintDisclosure: "Nano Banana 2 generates a semantic patch and the app composites it only inside the local mask. This is not native upstream mask inpainting.", inpaintChooseSource: "Choose source image", inpaintNoSource: "No image selected", inpaintPromptLabel: "Requested change", inpaintGenerate: "Generate candidates", inpaintApply: "Apply and add to results", inpaintInitial: "Choose a source image, then paint the area to change.", inpaintNeedSource: "Choose a source image first", inpaintNeedMask: "Paint the area to change first", inpaintNeedPrompt: "Enter the requested change", inpaintGenerating: "Generating candidate patch {done}/{total}…", inpaintApplied: "The local inpaint result was added to results", inpaintCandidateFailed: "Candidate {index} failed: {reason}", inpaintRequestedActual: "Requested: {requested} · actual: {actual}",
    savedApis: "Saved APIs", manualApi: "Manual entry", setDefaultApi: "Default", defaultApi: "Default API",
    apiProviderHint: "Recommended image gateway: https://grsai.com/zh. Manage it in your browser; the app will not open the website.",
    apiUrl: "API URL", grsaiEndpoint: "https://grsai.dakka.com.cn/v1/api/generate", grsaiWebsite: "Recommended image gateway: https://grsai.com/zh", useGrsaiEndpoint: "Use GrsAI URL",
    officialPanelTitle: "Official image options", officialPanelHint: "Sent only to the official OpenAI Image API and saved with this official API profile.", officialQuality: "Output quality", officialQualityHint: "Auto balances speed and detail; Low is for drafts, Medium for everyday work, and High for final assets.", optionAuto: "Auto", optionLow: "Low", optionMedium: "Medium", optionHigh: "High", officialBackground: "Background", officialBackgroundHint: "Transparent is useful for stickers and assets; gpt-image-2 does not currently support it.", optionOpaque: "Opaque", optionTransparent: "Transparent", officialOutputFormat: "Output format", officialOutputFormatHint: "PNG is lossless; JPEG is faster; WebP is usually smaller and supports transparency.", officialCompression: "Compression quality", officialCompressionHint: "JPEG/WebP only. Lower values make smaller files with more visible detail loss.", officialModeration: "Moderation level", officialModerationHint: "Auto uses standard filtering. Low is less restrictive but still follows OpenAI policy.", officialInputFidelity: "Input fidelity", officialInputFidelityHint: "Used only for edits/reference images. High better preserves people, style, and details and may cost more.", officialCapabilityDefault: "Select a model to see its size, transparency, and reference-image capabilities.", officialCapabilityGptImage2: "gpt-image-2 supports constrained custom sizes, does not support transparency, and always processes references at high fidelity.", officialCapabilityMini: "gpt-image-1-mini supports the three standard sizes and transparency, but input fidelity cannot be changed.", officialCapabilityLegacy: "This model supports the three standard sizes. Use PNG/WebP for transparency; reference fidelity can be Low or High.", grsaiPanelTitle: "GrsAI relay protocol", grsaiPanelHint: "Uses its own generate/result task protocol. Official OpenAI quality, format, and background fields are never sent here.", grsaiNodeHint: "China node · asynchronous polling · image URL output", grsaiWebsiteLabel: "Management site: https://grsai.com/zh", customPanelTitle: "Generic compatibility mode", customPanelHint: "Sends core fields through OpenAI-compatible generations/edits requests without OpenAI-official or GrsAI-specific fields.", grsaiRetryTitle: "GrsAI submission retries", officialModelsDetected: "Detected {count} available official OpenAI image models", officialModelsFallback: "Could not read the official model list. Built-in official image models were loaded: {reason}", officialModelsNoMatch: "No official image model was recognized for this key. The built-in list was loaded.", officialModelAuthFailed: "The OpenAI API key is invalid, unauthorized, or the project lacks model access",
    model: "Model", detect: "Detect", proxy: "Browser CORS proxy URL", saveConfig: "Save config",
    modelChoicesPlaceholder: "Choose from detected models...",
    desktopProxyTitle: "Desktop Network Proxy", desktopProxyMode: "Proxy mode", desktopProxyCustomUrl: "Custom proxy URL",
    desktopProxyHttp: "HTTP 127.0.0.1:7890", desktopProxySocks: "SOCKS5 127.0.0.1:10808", desktopProxyDirect: "Direct", desktopProxyCustom: "Custom",
    testDesktopProxy: "Test proxy", desktopProxyHint: "Default: HTTP 127.0.0.1:7890. In the browser, use the system/browser proxy or api-proxy.js.",
    desktopProxyBrowserOnly: "Browser pages cannot switch HTTP/SOCKS5 proxy directly. Use the system/browser proxy or api-proxy.js.",
    desktopProxyTesting: "Testing proxy...", desktopProxyOk: "Proxy test succeeded: {mode} {target}", desktopProxyFailed: "Proxy test failed: {reason}",
    desktopProxyInvalid: "Invalid custom proxy URL. Use http://host:port, https://host:port, or socks5://host:port.",
    connectApi: "Connect API", apiDetect: "Detect", apiConnected: "API connected", apiDisconnected: "API not connected",
    apiConnectHint: "Connect an API, then enter URL, key, and model",
    singleMode: "Single Image", comicMode: "Comic Panels", captionMode: "Caption Mode", prompt: "Prompt", globalPrompt: "Global Prompt",
    globalPromptComic: "Global Prompt (applied to all panels)", globalPromptCaption: "Global Prompt (applied to all images)", importTxt: "Import txt",
    promptPlaceholder: "Describe the image you want to generate. More detail is better...\n\nExample: an orange cat on a windowsill, sunlight through sheer curtains, oil painting style, warm tones",
    globalRefs: "Global reference images (optional, multiple)", uploadRefs: "Click or drag to upload reference images",
    uploadRefsClickOnly: "Click to upload reference images",
    captionUploadHint: "Click or drag to bulk-upload images (generated one at a time in filename order, never bundled into a single request)",
    captionUploadHintClickOnly: "Click to bulk-upload images (generated one at a time in filename order, never bundled into a single request)",
    generateAllCaptions: "Generate All Images",
    matchSize: "Match output size to reference", resolution: "Global Resolution", landscape: "Landscape 3:2", portrait: "Portrait 2:3",
    custom: "Custom", width: "W", height: "H", savedSizes: "Saved sizes", saveSizePreset: "Save size", deleteSizePreset: "Delete saved size", imageCount: "Image Count", sequential: "Generate sequentially",
    sequentialHint: "Unchecked: batch generation uses the current API concurrency limit. Checked: generate one image at a time.",
    panelList: "Panel List", captionList: "Caption List", addPanel: "Add Panel", clear: "Clear", batchCreate: "Batch Create", panelCount: "Panels",
    createBtn: "Create", autoFill: "Auto Fill", fill: "Fill", panelPrompt: "Panel Prompt", retry: "Retry",
    bulkPrompts: "Bulk Prompts", bulkComicTitle: "Bulk Panel Prompts", bulkCaptionTitle: "Bulk Caption Prompts",
    bulkComicHint: "One prompt per line, matched to panels in order. Blank lines keep their position.", bulkCaptionHint: "One prompt per line, matched by image filename order. Blank lines keep their position.",
    bulkPromptPlaceholder: "Prompt 1\nPrompt 2\nPrompt 3", bulkPromptCount: "{lines} lines / {rows} {unit}",
    applyBulkPrompts: "Apply in Order", cancel: "Cancel", noBulkPrompts: "Enter at least one non-empty prompt", noCaptionImages: "Upload images first",
    tooManyCaptionPrompts: "There are {lines} prompts but only {rows} images. Remove extra prompts or upload more images.",
    overwriteBulkPrompts: "Some matching rows already contain text. Overwrite them?", bulkPromptsApplied: "Applied {count} prompts in order", bulkPromptsRemaining: "; {count} {unit} left unchanged",
    reference: "Reference", generateImage: "Generate Image", generateAll: "Generate All Panels", cancelGeneration: "Cancel Generation",
    imageFolder: "Image Folder", zipFolder: "ZIP Folder", notSelected: "Not selected", zipName: "ZIP name (optional)...", projectExportName: "Project / folder name (optional)...",
    downloadZip: "Download ZIP", saveToFolder: "Save to Folder", savingToFolder: "Saving...", folderSaved: "Saved to folder", clearResults: "Clear Results", emptyTitle: "Generated images will appear here",
    emptyHint: "Enter a prompt on the left and click Generate Image", downloadPaths: "Download Paths",
    imageSaveFolder: "Image save folder", zipSaveFolder: "ZIP save folder", chooseFolder: "Choose Folder", imageAskEveryTime: "Ask where to save each image", zipAskEveryTime: "Ask where to save each ZIP", pathModeHint: "When unchecked, the saved folder above is used. When checked, a folder is requested for every save.", textSelectAll: "Select all", textCut: "Cut", textCopy: "Copy", textPaste: "Paste",
    historyTitle: "Generation History", historyHint: "Comic and caption jobs are saved as projects. Prompts stay collapsed; project data and images remain on this device.",
    searchHistory: "Search prompt / model / date", refresh: "Refresh", autoSaveHistory: "Automatically save successful generations",
    maxRecords: "Maximum records", clearAllHistory: "Clear All Records", imageCacheTitle: "Temporary image cache", cacheRetentionDays: "Auto-clean after days", cacheRetentionHint: "Successful generations are cached inside the app immediately so relay URLs cannot expire first. Files are written to your chosen folder only when you package a ZIP or save to a folder.", clearGeneratedCache: "Clear cache now", cacheAutoHint: "The cache is cleaned automatically on app launch and after new images are generated.", cacheCleared: "Cleared {count} cached images", cacheCleanupFailed: "Cache cleanup failed: {reason}", autoRetry: "Auto Retry", globalRetries: "Global retries",
    retryHint: "For generic APIs, only HTTP 400 retries automatically. 0 disables it. Per-panel retries override this.",
    grsaiSubmit504Retries: "GrsAI submit 504 retries", grsaiSubmit504Interval: "GrsAI submit 504 interval (seconds)",
    grsaiSubmit504Hint: "Used only when the initial GrsAI submission returns HTTP 504. Resubmitting can occasionally create duplicate images. Set retries to 0 to disable.",
    grsaiSubmit504Waiting: "GrsAI submission returned HTTP 504. Retry {retryIndex}/{maxRetries} in {seconds} seconds…",
    grsaiSubmit504Exhausted: "HTTP 504: The GrsAI submission still timed out after {count} automatic retries. The task may have been submitted; check the GrsAI dashboard before retrying manually.",
    restoreProject: "Restore Project", downloadProject: "Export Project", viewPrompts: "View prompts and panels",
    globalPromptLabel: "Global Prompt", panelLabel: "Panel", noPrompt: "No prompt", comicProject: "Comic Project", captionProject: "Caption Project", captionImageCol: "Image", captionBubbleCol: "Bubble Text",
    noHistory: "No generation history", expand: "Expand", collapse: "Collapse",
    noImagesToExport: "No images to export", exportOpenedHistory: "Current results are empty. History is open; use Export Project on a project card.", packaging: "Packaging...", preparingZip: "Preparing ZIP...",
    collectingImages: "Collecting images", compressing: "Creating ZIP", zipSaved: "ZIP saved", exportFailed: "Export failed",
    download: "Download", copyLink: "Copy Link", editRetry: "Edit & Retry", reloadImage: "Reload image", stopCardRetry: "Cancel",
    failReason: "Failure reason", retryFailedAll: "Retry all failed", cancelRetryFailedAll: "Cancel all retries", cancellingRetryFailedAll: "Cancelling all retries", failedRetryCount: "Extra attempts after failure", failedRetryCountHint: "Each card gets 1 initial attempt, then up to N extra attempts. Entering 10 means 11 attempts total.", noFailedToRetry: "No failed panels to retry",
    retryFailedAllStarted: "Retrying {count} failed items", retryFailedAllCancelled: "All failed retries cancelled. You can retry again.", retryQueued: "Waiting to retry (queue position {position})", retryQueuedHint: "The request has not been sent yet. It will start automatically when an earlier task finishes.", retryQueuedRound: "Preparing retry {attempt}/{maxAttempts}", bulkRetryRound: "Retry-all attempt {attempt}/{maxAttempts}", enqueueRemainingFailed: "Add remaining failures", remainingFailedAdded: "Added {count} missed failed items", noRemainingFailed: "No missed failures. The current queue is complete.",
    softwareUpdate: "Software Update", currentVersion: "Current version", latestVersion: "Latest version", updateAsset: "Update asset", notChecked: "Not checked", releaseNotesPlaceholder: "GitHub Release notes appear after checking for updates",
    checkUpdates: "Check updates", downloadUpdate: "Download update", installUpdate: "Download and install", openReleasePage: "Open release page",
    updateInitialHint: "Checks GitHub Releases for a new version. Windows can verify and replace the installation; macOS downloads and opens the update package; Android and iOS open the release page in the system browser.",
    checkingUpdates: "Checking for updates...", noUpdate: "Already up to date", updateAvailable: "New version available: {version}",
    updateCheckFailed: "Update check failed", noUpdateAsset: "No update package was found for this platform",
    downloadingUpdate: "Downloading update package...", updateDownloaded: "Update package downloaded: {path}",
    updateInstallStarted: "Update install started. Windows will close this app and replace the installation folder.",
    updateOpenRelease: "This environment cannot overwrite the app directly, so the update package link was opened.",
    updateOpenGithubMobile: "On Android, please download and install from the GitHub release page. It has been opened for you.",
    updateNowPrompt: "Update now?",
    installDir: "Install Directory",
    installDirHint: "Leave unset to automatically use the currently running install's folder. Pick a folder manually if you want updates to overwrite a different location (e.g. an older install on another drive).",
    resetInstallDir: "Reset to Auto",
    installDirUpdated: "Install directory updated; the next update will install there",
    installDirResetDone: "Reset to automatically follow the current install location"
  },
  ja: {
    langZh: "简体", langHant: "繁體", langEn: "EN", langJa: "日本語", langKo: "한국어",
    appTitle: "AI 画像生成", subtitle: "単体画像 · 漫画コマ · 吹き出し文字",
    web: "Web/PWA", desktop: "デスクトップ", android: "Android",
    create: "作成", panels: "絵コンテ", history: "履歴", export: "書き出し", settings: "設定",
    apiSettings: "API 設定", apiProvider: "API 種類", officialApi: "公式 API", opencodexApi: "OpenCodex ローカル画像", grsaiImageApi: "GrsAI 画像 API", customApi: "カスタム API",
    opencodexHint: "ローカル OpenCodex の ChatGPT ログイン経由で画像を生成します。プレースホルダーキーは OpenAI に送信されず、実際の利用枠は ChatGPT 側で決まります。",
    opencodexPanelTitle: "OpenCodex ローカル画像プロキシ", opencodexPanelHint: "ローカルの ChatGPT/Codex または Google Antigravity ログインを再利用します。127.0.0.1 のみに接続し、デスクトッププロキシは使用しません。", openCodexModel: "ローカル画像モデル", openCodexModelHint: "GPT Image 2 は汎用生成、Nano Banana 2 は複数参照・文字・意味編集に向いています。", opencodexQuality: "品質の希望", opencodexQualityHint: "非公開クォータ上流は実測で中品質固定です。他の品質段階は反映されません。", opencodexBackground: "背景", opencodexBackgroundHint: "gpt-image-2 には自動または不透明のみを送り、透明は送りません。", openCodexAspectRatio: "画面比率", openCodexAspectRatioHint: "Nano Banana 2 が公式対応する画面比率のみ選択できます。", openCodexImageSize: "解像度段階", openCodexImageSizeHint: "512/1K は最大 5、2K は 3、4K は 1 タスクです。", opencodexFacts: "JSON 画像プロトコル · GPT Image 2 · 中品質 · 約 157 万画素 · 同時 5 件", opencodexCapability: "実測出力は約 157 万画素、最長辺 2172 px、品質は中固定です。サイズ比率をプロンプトへ追加し、実際の画像寸法を正とします。", openCodexNanoFacts: "JSON 画像プロトコル · Nano Banana 2 · 最大同時 {concurrency} 件 · 620 秒タイムアウト", openCodexNanoCapability: "クライアント側参照画像は最大 8 枚。文字描画と意味編集に対応します。比率と段階は要求値で、実画像を正とします。", opencodexHealthCheck: "ローカルサービスを確認", opencodexHealthIdle: "未確認", opencodexHealthChecking: "OpenCodex に接続中…", opencodexHealthReady: "ローカルサービス利用可能 · OpenCodex {version}", opencodexHealthFailed: "ローカルサービスを利用できません：{reason}", openInpaint: "部分再描画", inpaintRequiresNano: "部分再描画には Nano Banana 2 が必要です", inpaintTitle: "部分再描画", inpaintDisclosure: "Nano Banana 2 が意味的なパッチを生成し、アプリがローカルマスク内だけに合成します。上流ネイティブの mask 再描画ではありません。", inpaintChooseSource: "元画像を選択", inpaintNoSource: "画像未選択", inpaintPromptLabel: "変更内容", inpaintGenerate: "候補を生成", inpaintApply: "適用して結果へ追加", inpaintInitial: "元画像を選び、変更する領域を塗ってください。", inpaintNeedSource: "先に元画像を選択してください", inpaintNeedMask: "先に変更する領域を塗ってください", inpaintNeedPrompt: "変更内容を入力してください", inpaintGenerating: "候補パッチを生成中 {done}/{total}…", inpaintApplied: "部分再描画結果を結果一覧へ追加しました", inpaintCandidateFailed: "候補 {index} 失敗：{reason}", inpaintRequestedActual: "要求：{requested} · 実際：{actual}",
    savedApis: "保存済み API", manualApi: "手動入力", setDefaultApi: "既定", defaultApi: "既定 API",
    apiProviderHint: "推奨画像中継サイト：https://grsai.com/zh。管理はブラウザで開き、アプリ内では遷移しません。",
    apiUrl: "API URL", grsaiEndpoint: "https://grsai.dakka.com.cn/v1/api/generate", grsaiWebsite: "推奨画像中継サイト：https://grsai.com/zh", useGrsaiEndpoint: "GrsAI URL を入力",
    officialPanelTitle: "公式画像パラメータ", officialPanelHint: "OpenAI 公式 Image API にのみ送信され、現在の公式 API 設定と一緒に保存されます。", officialQuality: "出力品質", officialQualityHint: "自動は速度と詳細を調整します。低は下書き、中は通常、高は最終素材向けです。", optionAuto: "自動", optionLow: "低", optionMedium: "中", optionHigh: "高", officialBackground: "背景", officialBackgroundHint: "透明は素材作成に便利ですが、gpt-image-2 は現在対応していません。", optionOpaque: "不透明", optionTransparent: "透明", officialOutputFormat: "出力形式", officialOutputFormatHint: "PNG は可逆、JPEG は高速、WebP は小さく透明にも対応します。", officialCompression: "圧縮品質", officialCompressionHint: "JPEG/WebP のみ。値を下げると小さくなりますが詳細が失われます。", officialModeration: "審査強度", officialModerationHint: "自動は標準フィルタ、低は制限を緩めますが公式ポリシーは適用されます。", officialInputFidelity: "参照画像の忠実度", officialInputFidelityHint: "編集/参照画像でのみ有効。高は人物・スタイル・詳細を保ちやすく、コストが上がる場合があります。", officialCapabilityDefault: "モデルを選択するとサイズ、透明背景、参照画像の能力を表示します。", officialCapabilityGptImage2: "gpt-image-2 は条件内のカスタムサイズに対応し、透明背景は非対応、参照画像は常に高忠実度です。", officialCapabilityMini: "gpt-image-1-mini は標準 3 サイズと透明背景に対応しますが、忠実度は変更できません。", officialCapabilityLegacy: "標準 3 サイズに対応します。透明背景は PNG/WebP を使用し、参照忠実度は低/高から選べます。", grsaiPanelTitle: "GrsAI 中継プロトコル", grsaiPanelHint: "独自の generate/result タスク方式を使用し、OpenAI 公式の品質・形式・背景は送信しません。", grsaiNodeHint: "中国ノード・非同期ポーリング・画像 URL 出力", grsaiWebsiteLabel: "管理サイト：https://grsai.com/zh", customPanelTitle: "汎用互換モード", customPanelHint: "OpenAI 互換 generations/edits の基本項目のみ送信し、公式または GrsAI 専用項目は追加しません。", grsaiRetryTitle: "GrsAI 送信再試行", officialModelsDetected: "利用可能な OpenAI 公式画像モデルを {count} 件検出しました", officialModelsFallback: "公式モデル一覧を取得できないため、内蔵モデルを読み込みました：{reason}", officialModelsNoMatch: "この Key では公式画像モデルを認識できなかったため、内蔵一覧を読み込みました", officialModelAuthFailed: "OpenAI API Key が無効、権限不足、またはプロジェクトにモデルアクセス権がありません",
    model: "モデル", detect: "検出", proxy: "ブラウザ CORS 転送 URL", saveConfig: "設定を保存",
    modelChoicesPlaceholder: "検出したモデルから選択…",
    desktopProxyTitle: "デスクトップネットワークプロキシ", desktopProxyMode: "プロキシモード", desktopProxyCustomUrl: "カスタムプロキシ URL",
    desktopProxyHttp: "HTTP 127.0.0.1:7890", desktopProxySocks: "SOCKS5 127.0.0.1:10808", desktopProxyDirect: "直結", desktopProxyCustom: "カスタム",
    testDesktopProxy: "プロキシをテスト", desktopProxyHint: "既定は HTTP 127.0.0.1:7890 です。ブラウザではシステム/ブラウザのプロキシまたは api-proxy.js を使用してください。",
    desktopProxyBrowserOnly: "ブラウザページから HTTP/SOCKS5 プロキシは切り替えられません。システム/ブラウザのプロキシまたは api-proxy.js を使用してください。",
    desktopProxyTesting: "プロキシをテスト中...", desktopProxyOk: "プロキシテスト成功：{mode} {target}", desktopProxyFailed: "プロキシテスト失敗：{reason}",
    desktopProxyInvalid: "カスタムプロキシ URL が無効です。http://host:port、https://host:port、socks5://host:port のみ対応しています。",
    connectApi: "API 接続", apiDetect: "検出", apiConnected: "API 接続済み", apiDisconnected: "API 未接続",
    apiConnectHint: "API 接続後、URL、Key、モデルを入力してください",
    singleMode: "単体画像", comicMode: "漫画コマ", captionMode: "テキスト入れモード", prompt: "プロンプト", globalPrompt: "全体プロンプト",
    globalPromptComic: "全体プロンプト（全コマに適用）", globalPromptCaption: "全体プロンプト（全画像に適用）", importTxt: "txt を読み込む",
    promptPlaceholder: "生成したい画像を詳しく説明してください...\n\n例：窓辺のオレンジ色の猫、薄いカーテン越しの光、油絵風、暖色",
    globalRefs: "全体参考画像（任意・複数可）", uploadRefs: "クリックまたはドラッグで参考画像をアップロード",
    uploadRefsClickOnly: "クリックで参考画像をアップロード",
    captionUploadHint: "クリックまたはドラッグで画像を一括アップロード（ファイル名順に1枚ずつ生成、まとめて送信はしません）",
    captionUploadHintClickOnly: "クリックで画像を一括アップロード（ファイル名順に1枚ずつ生成、まとめて送信はしません）",
    generateAllCaptions: "全画像を一括生成",
    matchSize: "出力サイズを参考画像に合わせる", resolution: "全体解像度", landscape: "横 3:2", portrait: "縦 2:3",
    custom: "カスタム", width: "幅", height: "高", savedSizes: "保存サイズ", saveSizePreset: "サイズ保存", deleteSizePreset: "保存サイズ削除", imageCount: "生成数", sequential: "順番に生成",
    sequentialHint: "オフ：現在の API の同時実行上限で一括生成。オン：1 枚ずつ順番に生成。",
    panelList: "コマ一覧", captionList: "テキスト入れ一覧", addPanel: "コマを追加", clear: "クリア", batchCreate: "一括作成", panelCount: "コマ数",
    createBtn: "作成", autoFill: "自動入力", fill: "入力", panelPrompt: "コマプロンプト", retry: "再試行",
    bulkPrompts: "プロンプト一括入力", bulkComicTitle: "コマプロンプト一括入力", bulkCaptionTitle: "文字入れプロンプト一括入力",
    bulkComicHint: "1行に1件、コマ順に対応します。空行も位置として保持されます。", bulkCaptionHint: "1行に1件、画像ファイル名順に対応します。空行も位置として保持されます。",
    bulkPromptPlaceholder: "プロンプト 1\nプロンプト 2\nプロンプト 3", bulkPromptCount: "入力 {lines} 行 / 現在 {rows} {unit}",
    applyBulkPrompts: "順番に入力", cancel: "キャンセル", noBulkPrompts: "空でないプロンプトを1件以上入力してください", noCaptionImages: "先に画像を一括アップロードしてください",
    tooManyCaptionPrompts: "プロンプトは {lines} 件ですが、画像は {rows} 枚です。余分なプロンプトを削除するか画像を追加してください。",
    overwriteBulkPrompts: "対応する行に内容があります。上書きしますか？", bulkPromptsApplied: "{count} 件のプロンプトを順番に入力しました", bulkPromptsRemaining: "、残り {count} {unit}は変更していません",
    reference: "参考", generateImage: "画像を生成", generateAll: "全コマを生成", cancelGeneration: "生成をキャンセル",
    imageFolder: "画像フォルダ", zipFolder: "ZIP フォルダ", notSelected: "未選択", zipName: "ZIP 名（任意）...", projectExportName: "プロジェクト / フォルダー名（任意）...",
    downloadZip: "ZIP ダウンロード", saveToFolder: "フォルダーに保存", savingToFolder: "保存中……", folderSaved: "フォルダーに保存しました", clearResults: "結果をクリア", emptyTitle: "生成画像はここに表示されます",
    emptyHint: "左側にプロンプトを入力し、生成を開始してください", downloadPaths: "保存先",
    imageSaveFolder: "画像保存先", zipSaveFolder: "ZIP 保存先", chooseFolder: "フォルダ選択", imageAskEveryTime: "画像保存時に毎回保存先を確認", zipAskEveryTime: "ZIP 保存時に毎回保存先を確認", pathModeHint: "未選択の場合は上の保存先を使用します。選択すると保存のたびにフォルダーを確認します。", textSelectAll: "すべて選択", textCut: "切り取り", textCopy: "コピー", textPaste: "貼り付け",
    historyTitle: "生成履歴", historyHint: "漫画と文字入れはプロジェクトとして保存されます。プロンプトは折りたたまれ、データと画像は端末内に保存されます。",
    searchHistory: "プロンプト / モデル / 日付を検索", refresh: "更新", autoSaveHistory: "成功した生成を自動保存",
    maxRecords: "最大記録数", clearAllHistory: "すべて削除", imageCacheTitle: "画像一時キャッシュ", cacheRetentionDays: "自動削除までの日数", cacheRetentionHint: "中継画像 URL の期限切れを防ぐため、生成成功後すぐにアプリ内へキャッシュします。選択したフォルダーへ書き込むのは ZIP 作成またはフォルダー保存時だけです。", clearGeneratedCache: "今すぐキャッシュを削除", cacheAutoHint: "キャッシュはアプリ起動時と新しい画像の生成後に自動整理されます。", cacheCleared: "{count} 件のキャッシュ画像を削除しました", cacheCleanupFailed: "キャッシュの整理に失敗しました：{reason}", autoRetry: "自動再試行", globalRetries: "全体再試行回数",
    retryHint: "汎用 API は HTTP 400 の場合のみ自動再試行します。0 は無効。コマごとの設定が優先されます。",
    grsaiSubmit504Retries: "GrsAI 送信 504 の再試行回数", grsaiSubmit504Interval: "GrsAI 送信 504 の間隔（秒）",
    grsaiSubmit504Hint: "GrsAI の初回送信が HTTP 504 を返した場合だけ使用します。再送により重複画像が生成される場合があります。0 で無効化します。",
    grsaiSubmit504Waiting: "GrsAI 送信が HTTP 504 を返しました。{seconds} 秒後に {retryIndex}/{maxRetries} 回目を再試行します…",
    grsaiSubmit504Exhausted: "HTTP 504：GrsAI 送信は {count} 回の自動再試行後もタイムアウトしました。タスクが送信済みの可能性があるため、手動再試行の前に GrsAI ダッシュボードを確認してください。",
    restoreProject: "プロジェクト復元", downloadProject: "プロジェクト書き出し", viewPrompts: "プロンプトとコマを見る",
    globalPromptLabel: "全体プロンプト", panelLabel: "コマ", noPrompt: "プロンプトなし", comicProject: "漫画プロジェクト", captionProject: "テキスト入れプロジェクト", captionImageCol: "画像", captionBubbleCol: "吹き出しテキスト",
    noHistory: "生成履歴はありません", expand: "展開", collapse: "折りたたむ",
    noImagesToExport: "書き出せる画像がありません", exportOpenedHistory: "現在の結果は空です。履歴を開いたので、プロジェクトカードの書き出しを使ってください。", packaging: "パッケージ中...", preparingZip: "ZIP 準備中...",
    collectingImages: "画像を収集中", compressing: "ZIP 作成中", zipSaved: "ZIP 保存済み", exportFailed: "書き出し失敗",
    download: "ダウンロード", copyLink: "リンクをコピー", editRetry: "編集して再試行", reloadImage: "画像を再読み込み", stopCardRetry: "キャンセル",
    failReason: "失敗理由", retryFailedAll: "失敗分を再試行", cancelRetryFailedAll: "すべての再試行をキャンセル", cancellingRetryFailedAll: "すべての再試行をキャンセル中", failedRetryCount: "失敗後の追加回数", failedRetryCountHint: "各カードをまず 1 回実行し、失敗後に最大 N 回追加します。10 は合計最大 11 回です。", noFailedToRetry: "再試行できる失敗コマはありません",
    retryFailedAllStarted: "{count} 件の失敗項目を再試行中", retryFailedAllCancelled: "失敗項目の再試行をキャンセルしました。再度実行できます。", retryQueued: "再試行待ち（キュー {position} 番）", retryQueuedHint: "まだリクエストは送信されていません。前の処理が終わると自動的に開始します。", retryQueuedRound: "{attempt}/{maxAttempts} 回目の再試行を準備中", bulkRetryRound: "一括再試行 {attempt}/{maxAttempts} 回目", enqueueRemainingFailed: "残りの失敗を追加", remainingFailedAdded: "漏れていた失敗項目を {count} 件追加しました", noRemainingFailed: "漏れている失敗項目はありません。現在のキューは完全です。",
    softwareUpdate: "ソフトウェア更新", currentVersion: "現在のバージョン", latestVersion: "最新バージョン", updateAsset: "更新ファイル", notChecked: "未確認", releaseNotesPlaceholder: "更新確認後に GitHub Release ノートを表示",
    checkUpdates: "更新を確認", downloadUpdate: "更新をダウンロード", installUpdate: "ダウンロードしてインストール", openReleasePage: "リリースページを開く",
    updateInitialHint: "GitHub Releases から新しいバージョンを確認します。Windows は検証後にインストール先を更新し、macOS は更新パッケージをダウンロードして開き、Android と iOS はシステムブラウザでリリースページを開きます。",
    checkingUpdates: "更新を確認中...", noUpdate: "最新です", updateAvailable: "新しいバージョンがあります: {version}",
    updateCheckFailed: "更新確認に失敗しました", noUpdateAsset: "このプラットフォーム用の更新パッケージが見つかりません",
    downloadingUpdate: "更新パッケージをダウンロード中...", updateDownloaded: "更新パッケージを保存しました: {path}",
    updateInstallStarted: "更新インストールを開始しました。Windows はアプリを閉じてインストール先を更新します。",
    updateOpenRelease: "この環境では直接上書きできないため、更新パッケージのリンクを開きました。",
    updateOpenGithubMobile: "Android 版は GitHub のリリースページからダウンロード・インストールしてください。ページを開きました。",
    updateNowPrompt: "今すぐ更新しますか？",
    installDir: "インストール先",
    installDirHint: "空欄のままだと、更新時に現在実行中のインストール先フォルダーを自動的に使用します。別の場所（別ドライブの旧バージョンなど）に更新を上書きしたい場合は、手動で選択してください。",
    resetInstallDir: "自動に戻す",
    installDirUpdated: "インストール先を更新しました。次回の更新はこのフォルダーにインストールされます",
    installDirResetDone: "現在のインストール先に自動的に従うよう戻しました"
  },
  ko: {
    langZh: "简体", langHant: "繁體", langEn: "EN", langJa: "日本語", langKo: "한국어",
    appTitle: "AI 이미지 생성기", subtitle: "단일 이미지 · 만화 컷 · 말풍선 문구",
    web: "Web/PWA", desktop: "데스크톱", android: "Android",
    create: "생성", panels: "콘티", history: "기록", export: "내보내기", settings: "설정",
    apiSettings: "API 설정", apiProvider: "API 유형", officialApi: "공식 API", opencodexApi: "OpenCodex 로컬 이미지", grsaiImageApi: "GrsAI 이미지 API", customApi: "사용자 API",
    opencodexHint: "로컬 OpenCodex의 ChatGPT 로그인으로 이미지를 생성합니다. 자리표시자 키는 OpenAI로 전송되지 않으며 실제 사용 한도는 ChatGPT에서 결정합니다.",
    opencodexPanelTitle: "OpenCodex 로컬 이미지 프록시", opencodexPanelHint: "로컬 ChatGPT/Codex 또는 Google Antigravity 로그인을 재사용합니다. 127.0.0.1에만 연결하며 데스크톱 프록시는 사용하지 않습니다.", openCodexModel: "로컬 이미지 모델", openCodexModelHint: "GPT Image 2는 범용 생성, Nano Banana 2는 다중 참고·문자·의미 편집에 적합합니다.", opencodexQuality: "품질 선호", opencodexQualityHint: "비공개 할당량 업스트림은 실측상 중간 품질로 고정되며 다른 품질 단계는 적용되지 않습니다.", opencodexBackground: "배경", opencodexBackgroundHint: "gpt-image-2에는 자동 또는 불투명만 전송하며 투명은 전송하지 않습니다.", openCodexAspectRatio: "화면 비율", openCodexAspectRatioHint: "Nano Banana 2가 공식 지원하는 화면 비율만 선택할 수 있습니다.", openCodexImageSize: "해상도 단계", openCodexImageSizeHint: "512/1K는 최대 5개, 2K는 3개, 4K는 1개 작업입니다.", opencodexFacts: "JSON 이미지 프로토콜 · GPT Image 2 · 중간 품질 · 약 157만 화소 · 동시 5개", opencodexCapability: "실측 출력은 약 157만 화소, 최장변 2172 px, 품질은 중간으로 고정됩니다. 크기 비율을 프롬프트에 추가하며 실제 이미지 크기를 기준으로 합니다.", openCodexNanoFacts: "JSON 이미지 프로토콜 · Nano Banana 2 · 최대 동시 {concurrency}개 · 620초 제한", openCodexNanoCapability: "클라이언트 참고 이미지는 최대 8장입니다. 문자 렌더링과 의미 편집을 지원하며 비율과 단계는 요청 목표이고 실제 이미지를 기준으로 합니다.", opencodexHealthCheck: "로컬 서비스 확인", opencodexHealthIdle: "확인 전", opencodexHealthChecking: "OpenCodex 연결 중…", opencodexHealthReady: "로컬 서비스 사용 가능 · OpenCodex {version}", opencodexHealthFailed: "로컬 서비스를 사용할 수 없음: {reason}", openInpaint: "부분 다시 그리기", inpaintRequiresNano: "부분 다시 그리기에는 Nano Banana 2가 필요합니다", inpaintTitle: "부분 다시 그리기", inpaintDisclosure: "Nano Banana 2가 의미 패치를 만들고 앱이 로컬 마스크 안에서만 합성합니다. 업스트림 네이티브 mask 인페인팅이 아닙니다.", inpaintChooseSource: "원본 이미지 선택", inpaintNoSource: "선택된 이미지 없음", inpaintPromptLabel: "변경 내용", inpaintGenerate: "후보 생성", inpaintApply: "적용하고 결과에 추가", inpaintInitial: "원본 이미지를 선택한 뒤 변경할 영역을 칠하세요.", inpaintNeedSource: "먼저 원본 이미지를 선택하세요", inpaintNeedMask: "먼저 변경할 영역을 칠하세요", inpaintNeedPrompt: "변경 내용을 입력하세요", inpaintGenerating: "후보 패치 생성 중 {done}/{total}…", inpaintApplied: "부분 다시 그리기 결과를 결과 목록에 추가했습니다", inpaintCandidateFailed: "후보 {index} 실패: {reason}", inpaintRequestedActual: "요청: {requested} · 실제: {actual}",
    savedApis: "저장된 API", manualApi: "직접 입력", setDefaultApi: "기본", defaultApi: "기본 API",
    apiProviderHint: "추천 이미지 중계 사이트: https://grsai.com/zh. 관리는 브라우저에서 열고 앱 안에서는 이동하지 않습니다.",
    apiUrl: "API URL", grsaiEndpoint: "https://grsai.dakka.com.cn/v1/api/generate", grsaiWebsite: "추천 이미지 중계 사이트: https://grsai.com/zh", useGrsaiEndpoint: "GrsAI URL 입력",
    officialPanelTitle: "공식 이미지 옵션", officialPanelHint: "OpenAI 공식 Image API에만 전송되며 현재 공식 API 설정과 함께 저장됩니다.", officialQuality: "출력 품질", officialQualityHint: "자동은 속도와 세부 묘사를 조절합니다. 낮음은 초안, 중간은 일반 작업, 높음은 최종 결과에 적합합니다.", optionAuto: "자동", optionLow: "낮음", optionMedium: "중간", optionHigh: "높음", officialBackground: "배경", officialBackgroundHint: "투명 배경은 스티커와 소재에 유용하지만 gpt-image-2는 현재 지원하지 않습니다.", optionOpaque: "불투명", optionTransparent: "투명", officialOutputFormat: "출력 형식", officialOutputFormatHint: "PNG는 무손실, JPEG는 빠르며 WebP는 보통 더 작고 투명을 지원합니다.", officialCompression: "압축 품질", officialCompressionHint: "JPEG/WebP 전용입니다. 값이 낮을수록 파일은 작아지고 세부 손실이 커집니다.", officialModeration: "콘텐츠 심사 강도", officialModerationHint: "자동은 표준 필터를 사용합니다. 낮음은 제한이 적지만 공식 정책은 계속 적용됩니다.", officialInputFidelity: "참고 이미지 충실도", officialInputFidelityHint: "편집/참고 이미지에서만 적용됩니다. 높음은 인물, 스타일, 세부를 더 잘 보존하며 비용이 늘 수 있습니다.", officialCapabilityDefault: "모델을 선택하면 크기, 투명 배경 및 참고 이미지 기능을 표시합니다.", officialCapabilityGptImage2: "gpt-image-2는 조건을 만족하는 사용자 크기를 지원하고 투명 배경은 지원하지 않으며 참고 이미지를 항상 높은 충실도로 처리합니다.", officialCapabilityMini: "gpt-image-1-mini는 표준 3가지 크기와 투명 배경을 지원하지만 충실도를 변경할 수 없습니다.", officialCapabilityLegacy: "표준 3가지 크기를 지원합니다. 투명 배경은 PNG/WebP를 사용하고 참고 충실도는 낮음/높음으로 선택할 수 있습니다.", grsaiPanelTitle: "GrsAI 중계 프로토콜", grsaiPanelHint: "독립적인 generate/result 작업 프로토콜을 사용하며 OpenAI 공식 품질, 형식, 배경 필드는 전송하지 않습니다.", grsaiNodeHint: "중국 노드 · 비동기 폴링 · 이미지 URL 출력", grsaiWebsiteLabel: "관리 사이트: https://grsai.com/zh", customPanelTitle: "일반 호환 모드", customPanelHint: "OpenAI 호환 generations/edits 기본 필드만 전송하며 공식 또는 GrsAI 전용 필드는 추가하지 않습니다.", grsaiRetryTitle: "GrsAI 제출 재시도", officialModelsDetected: "사용 가능한 OpenAI 공식 이미지 모델 {count}개를 감지했습니다", officialModelsFallback: "공식 모델 목록을 읽지 못해 내장 공식 이미지 모델을 불러왔습니다: {reason}", officialModelsNoMatch: "이 Key의 모델 목록에서 공식 이미지 모델을 찾지 못해 내장 목록을 불러왔습니다", officialModelAuthFailed: "OpenAI API Key가 잘못되었거나 권한이 없거나 프로젝트에 모델 접근 권한이 없습니다",
    model: "모델", detect: "감지", proxy: "브라우저 CORS 프록시 URL", saveConfig: "설정 저장",
    modelChoicesPlaceholder: "감지된 모델에서 선택...",
    desktopProxyTitle: "데스크톱 네트워크 프록시", desktopProxyMode: "프록시 모드", desktopProxyCustomUrl: "사용자 프록시 URL",
    desktopProxyHttp: "HTTP 127.0.0.1:7890", desktopProxySocks: "SOCKS5 127.0.0.1:10808", desktopProxyDirect: "직접 연결", desktopProxyCustom: "사용자 지정",
    testDesktopProxy: "프록시 테스트", desktopProxyHint: "기본값은 HTTP 127.0.0.1:7890입니다. 브라우저에서는 시스템/브라우저 프록시 또는 api-proxy.js를 사용하세요.",
    desktopProxyBrowserOnly: "브라우저 페이지에서는 HTTP/SOCKS5 프록시를 직접 전환할 수 없습니다. 시스템/브라우저 프록시 또는 api-proxy.js를 사용하세요.",
    desktopProxyTesting: "프록시 테스트 중...", desktopProxyOk: "프록시 테스트 성공: {mode} {target}", desktopProxyFailed: "프록시 테스트 실패: {reason}",
    desktopProxyInvalid: "사용자 프록시 URL이 잘못되었습니다. http://host:port, https://host:port, socks5://host:port만 지원합니다.",
    connectApi: "API 연결", apiDetect: "감지", apiConnected: "API 연결됨", apiDisconnected: "API 미연결",
    apiConnectHint: "API를 연결한 뒤 URL, Key, 모델을 입력하세요",
    singleMode: "단일 이미지", comicMode: "만화 콘티", captionMode: "말풍선 모드", prompt: "프롬프트", globalPrompt: "전체 프롬프트",
    globalPromptComic: "전체 프롬프트(모든 콘티에 적용)", globalPromptCaption: "전체 프롬프트(모든 이미지에 적용)", importTxt: "txt 가져오기",
    promptPlaceholder: "생성할 이미지를 자세히 설명하세요...\n\n예: 창가에 앉은 주황색 고양이, 커튼 사이로 비치는 햇빛, 유화 스타일, 따뜻한 톤",
    globalRefs: "전체 참고 이미지(선택, 다중)", uploadRefs: "클릭하거나 드래그해 참고 이미지 업로드",
    uploadRefsClickOnly: "클릭하여 참고 이미지 업로드",
    captionUploadHint: "클릭하거나 드래그해 이미지를 일괄 업로드(파일명 순서대로 한 장씩 생성하며, 한 번에 묶어서 보내지 않음)",
    captionUploadHintClickOnly: "클릭하여 이미지를 일괄 업로드(파일명 순서대로 한 장씩 생성하며, 한 번에 묶어서 보내지 않음)",
    generateAllCaptions: "전체 이미지 일괄 생성",
    matchSize: "출력 크기를 참고 이미지와 맞춤", resolution: "전체 해상도", landscape: "가로 3:2", portrait: "세로 2:3",
    custom: "사용자 지정", width: "너비", height: "높이", savedSizes: "저장 크기", saveSizePreset: "크기 저장", deleteSizePreset: "저장 크기 삭제", imageCount: "생성 수", sequential: "순차 생성",
    sequentialHint: "선택 해제: 현재 API의 동시 처리 한도에 따라 일괄 생성. 선택: 한 장씩 순차 생성.",
    panelList: "콘티 목록", captionList: "말풍선 목록", addPanel: "콘티 추가", clear: "비우기", batchCreate: "일괄 생성", panelCount: "콘티 수",
    createBtn: "생성", autoFill: "자동 입력", fill: "입력", panelPrompt: "콘티 프롬프트", retry: "재시도",
    bulkPrompts: "프롬프트 일괄 입력", bulkComicTitle: "콘티 프롬프트 일괄 입력", bulkCaptionTitle: "말풍선 프롬프트 일괄 입력",
    bulkComicHint: "한 줄에 하나씩 콘티 순서대로 대응합니다. 빈 줄도 위치를 유지합니다.", bulkCaptionHint: "한 줄에 하나씩 이미지 파일명 순서대로 대응합니다. 빈 줄도 위치를 유지합니다.",
    bulkPromptPlaceholder: "프롬프트 1\n프롬프트 2\n프롬프트 3", bulkPromptCount: "입력 {lines}줄 / 현재 {rows}개 {unit}",
    applyBulkPrompts: "순서대로 입력", cancel: "취소", noBulkPrompts: "비어 있지 않은 프롬프트를 하나 이상 입력하세요", noCaptionImages: "먼저 이미지를 일괄 업로드하세요",
    tooManyCaptionPrompts: "프롬프트는 {lines}개지만 이미지는 {rows}장뿐입니다. 초과 프롬프트를 삭제하거나 이미지를 더 업로드하세요.",
    overwriteBulkPrompts: "대응 위치에 기존 내용이 있습니다. 덮어쓸까요?", bulkPromptsApplied: "프롬프트 {count}개를 순서대로 입력했습니다", bulkPromptsRemaining: ", 나머지 {count}개 {unit}은 변경하지 않았습니다",
    reference: "참고", generateImage: "이미지 생성", generateAll: "모든 콘티 생성", cancelGeneration: "생성 취소",
    imageFolder: "이미지 폴더", zipFolder: "ZIP 폴더", notSelected: "선택 안 됨", zipName: "ZIP 이름(선택)...", projectExportName: "프로젝트 / 폴더 이름(선택)...",
    downloadZip: "ZIP 다운로드", saveToFolder: "폴더에 저장", savingToFolder: "저장 중……", folderSaved: "폴더에 저장됨", clearResults: "결과 비우기", emptyTitle: "생성된 이미지가 여기에 표시됩니다",
    emptyHint: "왼쪽에 프롬프트를 입력하고 생성 버튼을 누르세요", downloadPaths: "다운로드 경로",
    imageSaveFolder: "이미지 저장 폴더", zipSaveFolder: "ZIP 저장 폴더", chooseFolder: "폴더 선택", imageAskEveryTime: "이미지를 저장할 때마다 경로 묻기", zipAskEveryTime: "ZIP을 저장할 때마다 경로 묻기", pathModeHint: "선택하지 않으면 위의 저장 폴더를 사용합니다. 선택하면 저장할 때마다 폴더를 다시 묻습니다.", textSelectAll: "전체 선택", textCut: "잘라내기", textCopy: "복사", textPaste: "붙여넣기",
    historyTitle: "생성 기록", historyHint: "만화와 캡션 작업은 프로젝트로 저장됩니다. 프롬프트는 접혀 있으며 데이터와 이미지는 이 기기에 보관됩니다.",
    searchHistory: "프롬프트 / 모델 / 날짜 검색", refresh: "새로고침", autoSaveHistory: "성공한 생성 자동 저장",
    maxRecords: "최대 기록 수", clearAllHistory: "모든 기록 삭제", imageCacheTitle: "이미지 임시 캐시", cacheRetentionDays: "자동 정리 일수", cacheRetentionHint: "중계 이미지 URL 만료를 막기 위해 생성 성공 즉시 앱 내부에 캐시합니다. 선택한 폴더에는 ZIP 패키징 또는 폴더 저장을 실행할 때만 파일을 씁니다.", clearGeneratedCache: "지금 캐시 정리", cacheAutoHint: "캐시는 앱 시작 시와 새 이미지 생성 후 자동으로 정리됩니다.", cacheCleared: "캐시 이미지 {count}개를 정리했습니다", cacheCleanupFailed: "캐시 정리 실패: {reason}", autoRetry: "자동 재시도", globalRetries: "전체 재시도 횟수",
    retryHint: "일반 API는 HTTP 400인 경우에만 자동 재시도합니다. 0은 비활성화이며 콘티별 설정이 우선합니다.",
    grsaiSubmit504Retries: "GrsAI 제출 504 재시도 횟수", grsaiSubmit504Interval: "GrsAI 제출 504 간격(초)",
    grsaiSubmit504Hint: "GrsAI 최초 제출이 HTTP 504를 반환할 때만 사용합니다. 재제출로 중복 이미지가 생성될 수 있습니다. 0으로 비활성화합니다.",
    grsaiSubmit504Waiting: "GrsAI 제출이 HTTP 504를 반환했습니다. {seconds}초 후 {retryIndex}/{maxRetries}번째 재시도를 진행합니다…",
    grsaiSubmit504Exhausted: "HTTP 504: GrsAI 제출이 {count}회의 자동 재시도 후에도 시간 초과되었습니다. 작업이 제출되었을 수 있으므로 수동 재시도 전에 GrsAI 대시보드를 확인하세요.",
    restoreProject: "프로젝트 복원", downloadProject: "프로젝트 내보내기", viewPrompts: "프롬프트와 콘티 보기",
    globalPromptLabel: "전체 프롬프트", panelLabel: "콘티", noPrompt: "프롬프트 없음", comicProject: "만화 프로젝트", captionProject: "말풍선 프로젝트", captionImageCol: "이미지", captionBubbleCol: "말풍선 텍스트",
    noHistory: "생성 기록 없음", expand: "펼치기", collapse: "접기",
    noImagesToExport: "내보낼 이미지가 없습니다", exportOpenedHistory: "현재 결과가 비어 있어 기록을 열었습니다. 프로젝트 카드에서 프로젝트 내보내기를 사용하세요.", packaging: "패키징 중...", preparingZip: "ZIP 준비 중...",
    collectingImages: "이미지 수집 중", compressing: "ZIP 생성 중", zipSaved: "ZIP 저장됨", exportFailed: "내보내기 실패",
    download: "다운로드", copyLink: "링크 복사", editRetry: "편집 후 재시도", reloadImage: "이미지 다시 불러오기", stopCardRetry: "취소",
    failReason: "실패 원인", retryFailedAll: "실패 항목 재시도", cancelRetryFailedAll: "모든 재시도 취소", cancellingRetryFailedAll: "모든 재시도 취소 중", failedRetryCount: "실패 후 추가 횟수", failedRetryCountHint: "각 카드를 먼저 1회 실행하고 실패 후 최대 N회 추가합니다. 10은 총 최대 11회입니다.", noFailedToRetry: "재시도할 실패 콘티가 없습니다",
    retryFailedAllStarted: "실패 항목 {count}개 재시도 중", retryFailedAllCancelled: "실패 항목 재시도를 모두 취소했습니다. 다시 시도할 수 있습니다.", retryQueued: "재시도 대기 중 (대기열 {position}번)", retryQueuedHint: "아직 요청을 보내지 않았습니다. 앞선 작업이 끝나면 자동으로 시작합니다.", retryQueuedRound: "{attempt}/{maxAttempts}번째 재시도 준비 중", bulkRetryRound: "전체 재시도 {attempt}/{maxAttempts}번째", enqueueRemainingFailed: "남은 실패 추가", remainingFailedAdded: "누락된 실패 항목 {count}개를 추가했습니다", noRemainingFailed: "누락된 실패 항목이 없습니다. 현재 대기열이 완전합니다.",
    softwareUpdate: "소프트웨어 업데이트", currentVersion: "현재 버전", latestVersion: "최신 버전", updateAsset: "업데이트 파일", notChecked: "확인 안 됨", releaseNotesPlaceholder: "업데이트 확인 후 GitHub Release 설명 표시",
    checkUpdates: "업데이트 확인", downloadUpdate: "업데이트 다운로드", installUpdate: "다운로드 및 설치", openReleasePage: "릴리스 페이지 열기",
    updateInitialHint: "GitHub Releases에서 새 버전을 확인합니다. Windows는 검증 후 설치를 교체하고, macOS는 업데이트 패키지를 내려받아 열며, Android와 iOS는 시스템 브라우저에서 릴리스 페이지를 엽니다.",
    checkingUpdates: "업데이트 확인 중...", noUpdate: "최신 버전입니다", updateAvailable: "새 버전 발견: {version}",
    updateCheckFailed: "업데이트 확인 실패", noUpdateAsset: "현재 플랫폼용 업데이트 패키지를 찾지 못했습니다",
    downloadingUpdate: "업데이트 패키지 다운로드 중...", updateDownloaded: "업데이트 패키지 다운로드됨: {path}",
    updateInstallStarted: "업데이트 설치가 시작되었습니다. Windows는 앱을 닫고 설치 폴더를 교체합니다.",
    updateOpenRelease: "현재 환경에서는 직접 덮어쓸 수 없어 업데이트 패키지 링크를 열었습니다.",
    updateOpenGithubMobile: "Android 버전은 GitHub 릴리스 페이지에서 다운로드 및 설치해주세요. 페이지를 열었습니다.",
    updateNowPrompt: "지금 업데이트하시겠습니까?",
    installDir: "설치 위치",
    installDirHint: "비워두면 업데이트 시 현재 실행 중인 설치 폴더를 자동으로 사용합니다. 다른 위치(예: 다른 드라이브에 있는 이전 버전)에 업데이트를 덮어쓰고 싶다면 수동으로 선택하세요.",
    resetInstallDir: "자동으로 재설정",
    installDirUpdated: "설치 위치가 업데이트되었습니다. 다음 업데이트부터 이 폴더에 설치됩니다",
    installDirResetDone: "현재 설치 위치를 자동으로 따르도록 재설정했습니다"
  }
};

const INPAINT_LOCALES = Object.freeze({
  "zh-CN": Object.freeze({
    inpaintRequiresGptImage2: "局部重绘仅支持 OpenCodex 或官方 OpenAI 的 gpt-image-2",
    inpaintOfficialDisclosure: "官方 OpenAI gpt-image-2 使用原生 mask；软件仍会在本地保护蒙版外像素。",
    inpaintOpenCodexDisclosure: "OpenCodex gpt-image-2 生成语义补丁；软件只在本地蒙版内合成。",
  }),
  "zh-Hant": Object.freeze({
    inpaintRequiresGptImage2: "局部重繪僅支援 OpenCodex 或官方 OpenAI 的 gpt-image-2",
    inpaintOfficialDisclosure: "官方 OpenAI gpt-image-2 使用原生 mask；軟體仍會在本機保護蒙版外像素。",
    inpaintOpenCodexDisclosure: "OpenCodex gpt-image-2 產生語意補丁；軟體只在本機蒙版內合成。",
  }),
  en: Object.freeze({
    inpaintRequiresGptImage2: "Local inpaint supports only gpt-image-2 through OpenCodex or the official OpenAI API",
    inpaintOfficialDisclosure: "Official OpenAI gpt-image-2 receives a native mask; the app also preserves pixels outside the local mask.",
    inpaintOpenCodexDisclosure: "OpenCodex gpt-image-2 generates a semantic patch that the app composites only inside the local mask.",
  }),
  ja: Object.freeze({
    inpaintRequiresGptImage2: "部分再描画は OpenCodex または公式 OpenAI の gpt-image-2 のみ対応します",
    inpaintOfficialDisclosure: "公式 OpenAI gpt-image-2 にはネイティブ mask を送信し、アプリでもマスク外の画素を保護します。",
    inpaintOpenCodexDisclosure: "OpenCodex gpt-image-2 が意味パッチを生成し、アプリがローカルマスク内だけに合成します。",
  }),
  ko: Object.freeze({
    inpaintRequiresGptImage2: "부분 다시 그리기는 OpenCodex 또는 공식 OpenAI의 gpt-image-2만 지원합니다",
    inpaintOfficialDisclosure: "공식 OpenAI gpt-image-2에는 네이티브 mask를 보내며 앱도 마스크 밖 픽셀을 보호합니다.",
    inpaintOpenCodexDisclosure: "OpenCodex gpt-image-2가 의미 패치를 만들고 앱이 로컬 마스크 안에서만 합성합니다.",
  }),
});

function cleanText(key) {
  return INPAINT_LOCALES[currentLanguage]?.[key]
    || INPAINT_LOCALES["zh-CN"]?.[key]
    || CLEAN_LOCALES[currentLanguage]?.[key]
    || CLEAN_LOCALES["zh-CN"][key]
    || key;
}

function localeTagForCurrentLanguage() {
  return LANGUAGE_LOCALE_TAGS[currentLanguage] || "zh-CN";
}

function setText(selector, key, root = document) {
  const el = root.querySelector?.(selector);
  if (el) el.textContent = cleanText(key);
}

function setAttr(selector, attr, key, root = document) {
  const el = root.querySelector?.(selector);
  if (el) el.setAttribute(attr, cleanText(key));
}

function setButtonText(el, iconName, key) {
  if (!el) return;
  el.innerHTML = `${icon(iconName)} ${cleanText(key)}`;
}

function setIconLabel(selector, iconName, key, root = document) {
  const el = root.querySelector?.(selector);
  if (el) el.innerHTML = `${icon(iconName)} ${cleanText(key)}`;
}

function interpolate(text, vars = {}) {
  return String(text).replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

function templateToRegex(template) {
  const parts = String(template).split(/(\{\d+\})/g).filter(Boolean);
  const pattern = parts.map(part => {
    if (/^\{\d+\}$/.test(part)) return "(.+)";
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return new RegExp(`^${pattern}$`);
}

function fillTemplate(template, values = []) {
  let text = String(template);
  values.forEach((value, index) => {
    text = text.split(`{${index + 1}}`).join(value ?? "");
  });
  return text;
}

function normalizeI18nSource(text) {
  const direct = I18N_REVERSE.get(String(text));
  if (direct) return direct;
  const fromPattern = sourceFromPattern(text);
  return fromPattern || String(text);
}

function tr(source, vars = {}) {
  const resolved = normalizeI18nSource(source);
  if (currentLanguage === "zh-CN") return interpolate(resolved, vars);
  const translated = I18N[resolved]?.[currentLanguage] || translatePattern(resolved) || resolved;
  return interpolate(translated, vars);
}

function translatePattern(text) {
  const source = sourceFromPattern(text);
  if (source && source !== text) return translatePattern(source);
  for (const [regex, sourceTemplate, translations] of I18N_PATTERNS) {
    const match = String(text).match(regex);
    if (!match) continue;
    if (currentLanguage === "zh-CN") return fillTemplate(sourceTemplate, match.slice(1));
    return fillTemplate(translations[currentLanguage] || sourceTemplate, match.slice(1));
  }
  return null;
}

function sourceFromPattern(text) {
  const value = String(text);
  for (const [regex, sourceTemplate, translations] of I18N_PATTERNS) {
    const sourceMatch = value.match(regex);
    if (sourceMatch) return fillTemplate(sourceTemplate, sourceMatch.slice(1));
    for (const template of Object.values(translations)) {
      const match = value.match(templateToRegex(template));
      if (match) return fillTemplate(sourceTemplate, match.slice(1));
    }
  }
  return null;
}

function translateTextValue(value) {
  if (!value || !String(value).trim()) return value;
  const text = String(value);
  const trimmed = text.trim();
  const leading = text.slice(0, text.indexOf(trimmed));
  const trailing = text.slice(text.indexOf(trimmed) + trimmed.length);
  const source = normalizeI18nSource(trimmed);
  const translated = currentLanguage === "zh-CN"
    ? source
    : (I18N[source]?.[currentLanguage] || translatePattern(source));
  return translated ? `${leading}${translated}${trailing}` : value;
}

function translateElement(root = document.body) {
  if (!root || root.nodeType === Node.COMMENT_NODE) return;
  const shouldSkip = node => {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!el?.closest?.("[data-no-i18n], script, style");
  };

  if (root.nodeType === Node.TEXT_NODE) {
    if (!shouldSkip(root)) {
      const next = translateTextValue(root.nodeValue);
      if (next !== root.nodeValue) root.nodeValue = next;
    }
    return;
  }

  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

  if (!shouldSkip(root) && root.nodeType === Node.ELEMENT_NODE) {
    ["title", "placeholder", "aria-label"].forEach(attr => {
      if (!root.hasAttribute(attr)) return;
      const current = root.getAttribute(attr);
      const next = translateTextValue(current);
      if (next !== current) root.setAttribute(attr, next);
    });
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldSkip(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(node => {
    const next = translateTextValue(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  });

  if (root.querySelectorAll) {
    root.querySelectorAll("[title], [placeholder], [aria-label]").forEach(el => {
      if (shouldSkip(el)) return;
      ["title", "placeholder", "aria-label"].forEach(attr => {
        if (!el.hasAttribute(attr)) return;
        const current = el.getAttribute(attr);
        const next = translateTextValue(current);
        if (next !== current) el.setAttribute(attr, next);
      });
    });
  }
}

function applyCleanLanguage() {
  const langNames = {
    "zh-CN": cleanText("langZh"),
    "zh-Hant": cleanText("langHant"),
    en: cleanText("langEn"),
    ja: cleanText("langJa"),
    ko: cleanText("langKo"),
  };
  if (dom.languageSelect) {
    Object.entries(langNames).forEach(([value, label]) => {
      const option = dom.languageSelect.querySelector(`option[value="${value}"]`);
      if (option) option.textContent = label;
    });
    dom.languageSelect.title = "Language";
  }
  if (dom.languageCurrent) dom.languageCurrent.textContent = langNames[currentLanguage] || cleanText("langZh");
  if (dom.languageMenu) {
    Object.entries(langNames).forEach(([value, label]) => {
      const option = dom.languageMenu.querySelector(`[data-lang="${value}"]`);
      if (!option) return;
      option.textContent = label;
      option.classList.toggle("active", value === currentLanguage);
      option.setAttribute("aria-selected", value === currentLanguage ? "true" : "false");
    });
  }

  document.title = cleanText("appTitle");
  const appNameMeta = document.querySelector('meta[name="application-name"]');
  if (appNameMeta) appNameMeta.setAttribute("content", cleanText("appTitle"));

  const title = $(".header h1");
  if (title) {
    const mark = title.querySelector(".brand-mark");
    title.textContent = "";
    if (mark) title.appendChild(mark);
    title.appendChild(document.createTextNode(cleanText("appTitle")));
  }
  setText(".subtitle", "subtitle");

  setIconLabel("#configSection .config-toggle", "settings", "apiSettings");
  setText("#apiProviderField > span", "apiProvider");
  const providerLabels = {
    official: "officialApi",
    opencodex: "opencodexApi",
    grsai: "grsaiImageApi",
    custom: "customApi",
  };
  Object.entries(providerLabels).forEach(([value, key]) => {
    const option = dom.apiProvider?.querySelector(`option[value="${value}"]`);
    if (option) option.textContent = cleanText(key);
  });
  customSelects.apiProvider?.syncLabel();
  setText("#apiProviderHint", "apiProviderHint");
  setText("#savedApiField > span", "savedApis");
  const manual = dom.savedApis?.querySelector('option[value=""]');
  if (manual) manual.textContent = cleanText("manualApi");
  customSelects.savedApis?.syncLabel();
  setButtonText(dom.setDefaultApi, "save", "setDefaultApi");
  setText("#apiEndpointField > span", "apiUrl");
  setText(".grsai-tip span", "grsaiWebsite");
  setButtonText($("#useGrsaiEndpoint"), "spark", "useGrsaiEndpoint");
  setText("#modelField > span", "model");
  setButtonText(dom.detectModels, "search", "detect");
  const modelChoicesPlaceholder = dom.modelChoices?.querySelector('option[value=""]');
  if (modelChoicesPlaceholder) modelChoicesPlaceholder.textContent = cleanText("modelChoicesPlaceholder");
  customSelects.modelChoices?.syncLabel();
  setText("#proxyEndpointField > span", "proxy");
  setButtonText(dom.saveConfig, "save", "saveConfig");
  setButtonText(dom.openApiConfig, "settings", "connectApi");
  setButtonText(dom.quickDetectModels, "search", "apiDetect");
  updateProviderOptionsLanguage();
  updateApiProviderHint(dom.apiProvider?.value || "custom");
  updateProviderPanelVisibility(dom.apiProvider?.value || "custom");
  updateApiQuickState();

  $$(".mode-tab", dom.modeTabs).forEach(tab => {
    const iconKey = tab.dataset.mode === "comic" ? "comic" : tab.dataset.mode === "caption" ? "bubble" : "image";
    const labelKey = tab.dataset.mode === "comic" ? "comicMode" : tab.dataset.mode === "caption" ? "captionMode" : "singleMode";
    setButtonText(tab, iconKey, labelKey);
  });

  const isComic = currentMode === "comic";
  const isCaption = currentMode === "caption";
  setText("#globalPromptField .field-label-text", isComic ? "globalPromptComic" : isCaption ? "globalPromptCaption" : "prompt");
  setButtonText(dom.importTxt, "file", "importTxt");
  if (dom.prompt) dom.prompt.placeholder = cleanText("promptPlaceholder");
  setText(".image-upload .upload-zone > span:last-child", isDragDropUnsupported() ? "uploadRefsClickOnly" : "uploadRefs");
  setText("#captionUploadZone > span:last-child", isDragDropUnsupported() ? "captionUploadHintClickOnly" : "captionUploadHint");
  setIconLabel("#useOrigSizeToggle > span", "size", "matchSize");
  setText("fieldset.field > legend", "resolution");
  setText(".size-option:nth-child(2) small", "landscape");
  setText(".size-option:nth-child(3) small", "portrait");
  setText(".size-custom > span:first-of-type", "custom");
  setAttr("#customWidth", "placeholder", "width");
  setAttr("#customHeight", "placeholder", "height");
  const savedSizesFirstOption = dom.savedSizes?.querySelector('option[value=""]');
  if (savedSizesFirstOption) savedSizesFirstOption.textContent = cleanText("savedSizes");
  customSelects.savedSizes?.syncLabel();
  setButtonText(dom.saveSizePreset, "save", "saveSizePreset");
  if (dom.deleteSizePreset) dom.deleteSizePreset.title = cleanText("deleteSizePreset");
  setText("#nImagesField > span", "imageCount");
  setText("#sequentialToggle > span", "sequential");
  setText("#sequentialModeHint", "sequentialHint");

  setIconLabel("#comicPanelSection .section-header > span", "comic", "panelList");
  setButtonText(dom.addPanel, "plus", "addPanel");
  setButtonText(dom.bulkInputPanelPrompts, "file", "bulkPrompts");
  if (dom.clearPanels) dom.clearPanels.textContent = cleanText("clear");
  setIconLabel("#captionSection .section-header > span", "bubble", "captionList");
  setButtonText(dom.bulkInputCaptionPrompts, "file", "bulkPrompts");
  if (dom.clearCaptionRows) dom.clearCaptionRows.textContent = cleanText("clear");
  setText(".tool-group:nth-child(1) .tool-label", "batchCreate");
  setText(".panel-count-control > span", "panelCount");
  if (dom.createPanels) dom.createPanels.textContent = cleanText("createBtn");
  setText(".tool-group-fill .tool-label", "autoFill");
  setButtonText(dom.autoFillPanels, "spark", "fill");
  setText("#captionSection .tool-group-fill .tool-label", "autoFill");
  setButtonText(dom.autoFillCaptionRows, "spark", "fill");
  updateBulkPromptDialogLanguage();
  setText(".panel-table th.col-prompt", "panelPrompt");
  setText(".panel-table th.col-size", "resolution");
  setText(".panel-table th.col-retry", "retry");
  setText(".panel-table th.col-img", "reference");
  setText("#captionTable th.col-img", "captionImageCol");
  setText("#captionTable th.col-prompt", "captionBubbleCol");

  setButtonText(dom.generateBtn, "spark", isComic ? "generateAll" : isCaption ? "generateAllCaptions" : "generateImage");
  setButtonText(dom.chooseImageDir, "image", "imageFolder");
  setButtonText(dom.chooseZipDir, "zip", "zipFolder");
  setButtonText(dom.downloadZip, "zip", "downloadZip");
  setButtonText(dom.saveComicFolder, "folder", "saveToFolder");
  if (dom.clearResults) dom.clearResults.textContent = cleanText("clearResults");
  setText(".retry-failed-count span", "failedRetryCount");
  if (dom.failedRetryCount) dom.failedRetryCount.title = cleanText("failedRetryCountHint");
  setButtonText(dom.enqueueRemainingFailed, "plus", "enqueueRemainingFailed");
  setRetryFailedButtonText();
  if (dom.zipFileName) dom.zipFileName.placeholder = cleanText(isComic || isCaption ? "projectExportName" : "zipName");
  if (dom.imageDirLabel && dom.imageDirLabel.textContent.trim()) dom.imageDirLabel.textContent = nativeDownload?.dirs?.images ? shortPathLabel(nativeDownload.dirs.images) : cleanText("notSelected");
  if (dom.zipDirLabel && dom.zipDirLabel.textContent.trim()) dom.zipDirLabel.textContent = nativeDownload?.dirs?.zips ? shortPathLabel(nativeDownload.dirs.zips) : cleanText("notSelected");
  setText("#emptyState h3", "emptyTitle");
  setText("#emptyState p", "emptyHint");

  setText("#settingsTitle", "settings");
  setText(".download-settings h3", "downloadPaths");
  setText(".download-settings .setting-row:nth-of-type(1) strong", "imageSaveFolder");
  setText(".download-settings .setting-row:nth-of-type(2) strong", "zipSaveFolder");
  setText(".download-settings .path-mode-option:nth-of-type(1) span", "imageAskEveryTime");
  setText(".download-settings .path-mode-option:nth-of-type(2) span", "zipAskEveryTime");
  setText(".download-settings > .field-hint:last-child", "pathModeHint");
  const textMenuLabels = { selectAll: "textSelectAll", cut: "textCut", copy: "textCopy", paste: "textPaste" };
  Object.entries(textMenuLabels).forEach(([action, key]) => {
    const button = dom.textContextMenu?.querySelector(`[data-text-action="${action}"]`);
    if (button) button.textContent = cleanText(key);
  });
  setText(".history-settings h3", "historyTitle");
  setText(".history-settings .checkbox-field span", "autoSaveHistory");
  setText(".history-settings .field span", "maxRecords");
  if (dom.clearHistory) dom.clearHistory.textContent = cleanText("clearAllHistory");
  setText(".cache-settings h3", "imageCacheTitle");
  setText(".cache-settings .field span", "cacheRetentionDays");
  setText(".cache-settings .field-hint", "cacheRetentionHint");
  if (dom.clearGeneratedCache) dom.clearGeneratedCache.textContent = cleanText("clearGeneratedCache");
  if (dom.generatedCacheStatus && !dom.generatedCacheStatus.dataset.customStatus) dom.generatedCacheStatus.textContent = cleanText("cacheAutoHint");
  setText(".retry-settings h3", "autoRetry");
  setText("#globalRetryLabel", "globalRetries");
  setText("#retryHint", "retryHint");
  setText("#grsaiSubmit504RetryLabel", "grsaiSubmit504Retries");
  setText("#grsaiSubmit504IntervalLabel", "grsaiSubmit504Interval");
  setText("#grsaiSubmit504Hint", "grsaiSubmit504Hint");
  setText(".proxy-settings h3", "desktopProxyTitle");
  setText(".proxy-settings .field:nth-of-type(1) span", "desktopProxyMode");
  setText(".proxy-settings .field:nth-of-type(2) span", "desktopProxyCustomUrl");
  const proxyLabels = {
    http7890: "desktopProxyHttp",
    socks10808: "desktopProxySocks",
    direct: "desktopProxyDirect",
    custom: "desktopProxyCustom",
  };
  Object.entries(proxyLabels).forEach(([value, key]) => {
    const option = dom.desktopProxyMode?.querySelector(`option[value="${value}"]`);
    if (option) option.textContent = cleanText(key);
  });
  customSelects.desktopProxyMode?.syncLabel();
  setButtonText(dom.testDesktopProxy, "search", "testDesktopProxy");
  if (dom.desktopProxyStatus && !dom.desktopProxyStatus.dataset.customStatus) {
    dom.desktopProxyStatus.textContent = cleanText("desktopProxyHint");
  }
  setText(".update-settings h3", "softwareUpdate");
  setText(".update-settings .update-version-row:nth-of-type(1) span", "currentVersion");
  setText(".update-settings .update-version-row:nth-of-type(2) span", "latestVersion");
  setText(".update-settings .update-version-row:nth-of-type(3) span", "updateAsset");
  if (dom.currentVersionLabel) dom.currentVersionLabel.textContent = `v${APP_VERSION}`;
  if (dom.latestVersionLabel && !latestUpdateRelease) dom.latestVersionLabel.textContent = cleanText("notChecked");
  if (dom.updateAssetLabel && !latestUpdateRelease) dom.updateAssetLabel.textContent = cleanText("notChecked");
  if (dom.updateNotes && !dom.updateNotes.value) dom.updateNotes.placeholder = cleanText("releaseNotesPlaceholder");
  setButtonText(dom.checkUpdates, "search", "checkUpdates");
  const updatePlatform = getRuntimePlatform();
  const updateActionKey = getUpdateActionKey(updatePlatform);
  const updateActionIcon = updateActionKey === "installUpdate" ? "spark" : updateActionKey === "openReleasePage" ? "web" : "download";
  setButtonText(dom.installUpdate, updateActionIcon, updateActionKey);
  if (dom.updateStatus && !dom.updateStatus.dataset.customStatus) dom.updateStatus.textContent = cleanText("updateInitialHint");
  setText("#installDirLabel", "installDir");
  setText("#installDirHint", "installDirHint");
  if (dom.settingsChooseInstallDir) dom.settingsChooseInstallDir.textContent = cleanText("chooseFolder");
  if (dom.settingsResetInstallDir) dom.settingsResetInstallDir.textContent = cleanText("resetInstallDir");
  setText("#historyTitle", "historyTitle");
  setText("#historyModal .modal-header .field-hint", "historyHint");
  setAttr("#historySearch", "placeholder", "searchHistory");
  if (dom.refreshHistory) dom.refreshHistory.textContent = cleanText("refresh");
  updateOfficialCostSummary();
}

function applyLanguage(lang) {
  currentLanguage = SUPPORTED_LANGS.includes(lang) ? lang : "zh-CN";
  localStorage.setItem(LANG_KEY, currentLanguage);
  document.documentElement.lang = currentLanguage;
  document.title = tr("AI 图片生成器");
  if (dom.languageSelect) dom.languageSelect.value = currentLanguage;
  if (dom.languageSelect) dom.languageSelect.title = tr("界面语言");
  dom.languageMenu?.querySelectorAll(".language-option").forEach(option => {
    option.setAttribute("aria-selected", option.dataset.lang === currentLanguage ? "true" : "false");
  });
  isApplyingLanguage = true;
  try {
    refreshLocalizedUiState();
    applyCleanLanguage();
    renderSavedApis();
    renderSavedSizes?.();
    updateApiProviderHint(dom.apiProvider?.value || "custom");
    updateApiQuickState();
  } finally {
    isApplyingLanguage = false;
  }
}

function initI18n() {
  if (dom.languageSelect) {
    dom.languageSelect.value = currentLanguage;
    dom.languageSelect.title = tr("界面语言");
    dom.languageSelect.addEventListener("change", () => applyLanguage(dom.languageSelect.value));
  }
  dom.languageMenuButton?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const isOpen = !dom.languageMenu?.classList.contains("hidden");
    setLanguageMenuOpen(!isOpen);
  });
  dom.languageMenuButton?.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setLanguageMenuOpen(true, event.key === "ArrowUp" ? "last" : "selected");
    }
  });
  dom.languageMenu?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-lang]");
    if (!option) return;
    event.preventDefault();
    event.stopPropagation();
    applyLanguage(option.dataset.lang);
    setLanguageMenuOpen(false);
    dom.languageMenuButton?.focus();
  });
  dom.languageMenu?.addEventListener("keydown", event => {
    const options = [...dom.languageMenu.querySelectorAll(".language-option")];
    const current = options.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      let next = current;
      if (event.key === "ArrowDown") next = (current + 1 + options.length) % options.length;
      if (event.key === "ArrowUp") next = (current - 1 + options.length) % options.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = options.length - 1;
      options[next]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setLanguageMenuOpen(false);
      dom.languageMenuButton?.focus();
    } else if (event.key === "Tab") {
      setLanguageMenuOpen(false);
    }
  });
  document.addEventListener("click", (event) => {
    if (!dom.languageControl?.contains(event.target)) setLanguageMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setLanguageMenuOpen(false);
  });
  applyLanguage(currentLanguage);

  const observer = new MutationObserver(mutations => {
    if (isApplyingLanguage) return;
    isApplyingLanguage = true;
    try {
      mutations.forEach(mutation => {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach(node => translateElement(node));
        } else if (mutation.type === "attributes") {
          translateElement(mutation.target);
        }
      });
    } finally {
      isApplyingLanguage = false;
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["title", "placeholder", "aria-label"],
  });
}

function setLanguageMenuOpen(open, focusPosition = "") {
  if (!dom.languageMenu || !dom.languageMenuButton) return;
  dom.languageMenu.classList.toggle("hidden", !open);
  dom.languageControl?.classList.toggle("is-open", open);
  dom.languageMenuButton.setAttribute("aria-expanded", open ? "true" : "false");
  const options = [...dom.languageMenu.querySelectorAll(".language-option")];
  options.forEach(option => option.setAttribute("aria-selected", option.dataset.lang === currentLanguage ? "true" : "false"));
  if (open && focusPosition) {
    const selected = options.find(option => option.dataset.lang === currentLanguage);
    (focusPosition === "last" ? options[options.length - 1] : selected || options[0])?.focus();
  }
}

// ─── DOM 引用 ──────────────────────────────────────────────
const dom = {
  // 配置
  apiProvider:   $("#apiProvider"),
  apiEndpoint:   $("#apiEndpoint"),
  apiKey:        $("#apiKey"),
  model:         $("#model"),
  proxyEndpoint: $("#proxyEndpoint"),
  modelChoices:  $("#modelChoices"),
  detectModels:  $("#detectModels"),
  saveConfig:    $("#saveConfig"),
  savedApis:     $("#savedApis"),
  setDefaultApi: $("#setDefaultApi"),
  deleteSavedApi:$("#deleteSavedApi"),
  toggleKey:     $("#toggleKey"),
  configSection: $("#configSection"),
  apiQuickCard:  $("#apiQuickCard"),
  apiStateDot:   $("#apiStateDot"),
  apiQuickTitle: $("#apiQuickTitle"),
  apiQuickMeta:  $("#apiQuickMeta"),
  openApiConfig: $("#openApiConfig"),
  quickDetectModels: $("#quickDetectModels"),
  officialProviderPanel: $("#officialProviderPanel"),
  openCodexProviderPanel: $("#openCodexProviderPanel"),
  grsaiProviderPanel: $("#grsaiProviderPanel"),
  customProviderPanel: $("#customProviderPanel"),
  openCodexModel: $("#openCodexModel"),
  openCodexQuality: $("#openCodexQuality"),
  openCodexBackground: $("#openCodexBackground"),
  openCodexAspectRatio: $("#openCodexAspectRatio"),
  openCodexImageSize: $("#openCodexImageSize"),
  testOpenCodexHealth: $("#testOpenCodexHealth"),
  openCodexHealthStatus: $("#openCodexHealthStatus"),
  openInpaintFromFile: $("#openInpaintFromFile"),
  inpaintSourceInput: $("#inpaintSourceInput"),
  officialQuality: $("#officialQuality"),
  officialBackground: $("#officialBackground"),
  officialOutputFormat: $("#officialOutputFormat"),
  officialOutputCompression: $("#officialOutputCompression"),
  officialCompressionField: $("#officialCompressionField"),
  officialCompressionValue: $("#officialCompressionValue"),
  officialModeration: $("#officialModeration"),
  officialInputFidelity: $("#officialInputFidelity"),
  officialInputFidelityField: $("#officialInputFidelityField"),
  officialCapabilityNote: $("#officialCapabilityNote"),
  officialCostSummary: $("#officialCostSummary"),
  officialCostLabel: $("#officialCostLabel"),
  officialEstimatedCost: $("#officialEstimatedCost"),
  officialCostBreakdown: $("#officialCostBreakdown"),
  officialRateStatus: $("#officialRateStatus"),
  officialPricingLink: $("#officialPricingLink"),
  refreshOfficialRate: $("#refreshOfficialRate"),
  // 模式
  inputPanel:    $(".input-panel"),
  modeTabs:      $("#modeTabs"),
  // 全局输入
  prompt:        $("#prompt"),
  importTxt:     $("#importTxt"),
  txtFileInput:  $("#txtFileInput"),
  promptHint:    $("#promptHint"),
  referenceField: $("#referenceField"),
  globalSizeField: $("#globalSizeField"),
  sizePolicyHint: $("#sizePolicyHint"),
  refImage:      $("#refImage"),
  uploadZone:    $("#uploadZone"),
  thumbGrid:     $("#thumbGrid"),
  useOrigSize:   $("#useOrigSize"),
  customWidth:   $("#customWidth"),
  customHeight:  $("#customHeight"),
  savedSizes:    $("#savedSizes"),
  saveSizePreset:$("#saveSizePreset"),
  deleteSizePreset:$("#deleteSizePreset"),
  txtFileBadges: $("#txtFileBadges"),
  // 单图专属
  nImages:       $("#nImages"),
  sequentialMode:$("#sequentialMode"),
  nImagesField:  $("#nImagesField"),
  // 漫画专属
  comicSection:  $("#comicPanelSection"),
  panelCount:    $("#panelCount"),
  createPanels:  $("#createPanels"),
  addPanel:      $("#addPanel"),
  clearPanels:   $("#clearPanels"),
  bulkInputPanelPrompts: $("#bulkInputPanelPrompts"),
  panelTbody:    $("#panelTbody"),
  // 嵌字专属
  captionSection: $("#captionSection"),
  captionUploadZone: $("#captionUploadZone"),
  captionBulkInput: $("#captionBulkInput"),
  captionTbody:  $("#captionTbody"),
  clearCaptionRows: $("#clearCaptionRows"),
  captionAutoFillTemplate: $("#captionAutoFillTemplate"),
  autoFillCaptionRows: $("#autoFillCaptionRows"),
  bulkInputCaptionPrompts: $("#bulkInputCaptionPrompts"),
  bulkPromptModal: $("#bulkPromptModal"),
  bulkPromptTitle: $("#bulkPromptTitle"),
  bulkPromptHint: $("#bulkPromptHint"),
  bulkPromptText: $("#bulkPromptText"),
  bulkPromptCount: $("#bulkPromptCount"),
  closeBulkPrompts: $("#closeBulkPrompts"),
  cancelBulkPrompts: $("#cancelBulkPrompts"),
  applyBulkPrompts: $("#applyBulkPrompts"),
  // 进度
  progressWrap:  $("#progressWrap"),
  progressFill:  $("#progressFill"),
  progressText:  $("#progressText"),
  // 生成
  generateBtn:   $("#generateBtn"),
  status:        $("#status"),
  // 结果
  emptyState:    $("#emptyState"),
  resultGrid:    $("#resultGrid"),
  resultToolbar: $("#resultToolbar"),
  downloadZip:   $("#downloadZip"),
  saveComicFolder: $("#saveComicFolder"),
  clearResults:  $("#clearResults"),
  retryFailedTools: $("#retryFailedTools"),
  retryFailedAll: $("#retryFailedAll"),
  enqueueRemainingFailed: $("#enqueueRemainingFailed"),
  failedRetryCount: $("#failedRetryCount"),
  loadingOverlay:$("#loadingOverlay"),
  loadingText:   $("#loadingText"),
  // ZIP & 分镜工具
  zipFileName:   $("#zipFileName"),
  chooseImageDir:$("#chooseImageDir"),
  chooseZipDir:  $("#chooseZipDir"),
  imageDirLabel: $("#imageDirLabel"),
  zipDirLabel:   $("#zipDirLabel"),
  downloadProgress: $("#downloadProgress"),
  downloadProgressFill: $("#downloadProgressFill"),
  downloadProgressText: $("#downloadProgressText"),
  autoFillPanels:$("#autoFillPanels"),
  autoFillTemplate:$("#autoFillTemplate"),
  // 主题
  themeToggle:   $("#themeToggle"),
  languageSelect:$("#languageSelect"),
  languageControl:$("#languageControl"),
  languageMenuButton:$("#languageMenuButton"),
  languageCurrent:$("#languageCurrent"),
  languageMenu:  $("#languageMenu"),
  // 设置
  settingsBtn:   $("#settingsBtn"),
  settingsModal: $("#settingsModal"),
  closeSettings: $("#closeSettings"),
  settingsChooseImageDir: $("#settingsChooseImageDir"),
  settingsChooseZipDir:   $("#settingsChooseZipDir"),
  settingsImageDirLabel:  $("#settingsImageDirLabel"),
  settingsZipDirLabel:    $("#settingsZipDirLabel"),
  imageAskEveryTime: $("#imageAskEveryTime"),
  zipAskEveryTime: $("#zipAskEveryTime"),
  textContextMenu: $("#textContextMenu"),
  settingsChooseInstallDir: $("#settingsChooseInstallDir"),
  settingsResetInstallDir:  $("#settingsResetInstallDir"),
  settingsInstallDirLabel:  $("#settingsInstallDirLabel"),
  installDirRow:  $("#installDirRow"),
  installDirHint: $("#installDirHint"),
  historyEnabled: $("#historyEnabled"),
  historyLimit:   $("#historyLimit"),
  cacheRetentionDays: $("#cacheRetentionDays"),
  clearGeneratedCache: $("#clearGeneratedCache"),
  generatedCacheStatus: $("#generatedCacheStatus"),
  retryCount:     $("#retryCount"),
  grsaiSubmit504RetryCount: $("#grsaiSubmit504RetryCount"),
  grsaiSubmit504RetryInterval: $("#grsaiSubmit504RetryInterval"),
  grsaiRetrySettings: $("#grsaiRetrySettings"),
  desktopProxyMode: $("#desktopProxyMode"),
  desktopProxyCustomUrl: $("#desktopProxyCustomUrl"),
  testDesktopProxy: $("#testDesktopProxy"),
  desktopProxyStatus: $("#desktopProxyStatus"),
  clearHistory:   $("#clearHistory"),
  currentVersionLabel: $("#currentVersionLabel"),
  latestVersionLabel:  $("#latestVersionLabel"),
  updateAssetLabel:    $("#updateAssetLabel"),
  updateNotes:         $("#updateNotes"),
  updateStatus:        $("#updateStatus"),
  checkUpdates:        $("#checkUpdates"),
  installUpdate:       $("#installUpdate"),
  // 历史
  historyBtn:    $("#historyBtn"),
  historyModal:  $("#historyModal"),
  closeHistory:  $("#closeHistory"),
  historySearch: $("#historySearch"),
  refreshHistory:$("#refreshHistory"),
  historyList:   $("#historyList"),
  // OpenCodex 局部重绘
  inpaintModal: $("#inpaintModal"),
  inpaintDisclosure: $("#inpaintDisclosure"),
  closeInpaint: $("#closeInpaint"),
  inpaintChooseSource: $("#inpaintChooseSource"),
  inpaintBaseCanvas: $("#inpaintBaseCanvas"),
  inpaintPreviewCanvas: $("#inpaintPreviewCanvas"),
  inpaintMaskCanvas: $("#inpaintMaskCanvas"),
  inpaintCanvasScroller: $("#inpaintCanvasScroller"),
  inpaintCanvasStage: $("#inpaintCanvasStage"),
  inpaintEmpty: $("#inpaintEmpty"),
  inpaintBrush: $("#inpaintBrush"),
  inpaintEraser: $("#inpaintEraser"),
  inpaintUndo: $("#inpaintUndo"),
  inpaintRedo: $("#inpaintRedo"),
  inpaintClearMask: $("#inpaintClearMask"),
  inpaintToggleMask: $("#inpaintToggleMask"),
  inpaintCompare: $("#inpaintCompare"),
  inpaintZoomFit: $("#inpaintZoomFit"),
  inpaintZoom100: $("#inpaintZoom100"),
  inpaintPrompt: $("#inpaintPrompt"),
  inpaintBrushSize: $("#inpaintBrushSize"),
  inpaintBrushSizeValue: $("#inpaintBrushSizeValue"),
  inpaintFeather: $("#inpaintFeather"),
  inpaintFeatherValue: $("#inpaintFeatherValue"),
  inpaintContext: $("#inpaintContext"),
  inpaintContextValue: $("#inpaintContextValue"),
  inpaintCandidateCount: $("#inpaintCandidateCount"),
  inpaintCandidateStrip: $("#inpaintCandidateStrip"),
  inpaintSourceMeta: $("#inpaintSourceMeta"),
  inpaintAlignment: $("#inpaintAlignment"),
  inpaintOffsetX: $("#inpaintOffsetX"),
  inpaintOffsetXValue: $("#inpaintOffsetXValue"),
  inpaintOffsetY: $("#inpaintOffsetY"),
  inpaintOffsetYValue: $("#inpaintOffsetYValue"),
  inpaintScale: $("#inpaintScale"),
  inpaintScaleValue: $("#inpaintScaleValue"),
  generateInpaint: $("#generateInpaint"),
  applyInpaint: $("#applyInpaint"),
  cancelInpaintGeneration: $("#cancelInpaintGeneration"),
  inpaintStatus: $("#inpaintStatus"),
};

// ─── 自绘下拉列表（替代原生 <select>，Windows exe 端原生弹出层不可用）──────
// webview_windows 在 Windows 端是离屏渲染 WebView2（截屏合成到 Flutter），原生
// <select> 展开的选项列表是 Chromium 内部另开的 OS 弹出窗口，不在被截屏的离屏
// 表面里，因此打包后的 exe 完全不显示/错位，还可能吃掉输入焦点导致页面卡死没
// 反应。HTML/浏览器端因为是真实浏览器渲染原生弹出层，不受影响。所以这个问题只
// 在 exe 端出现，浏览器端一直是正常的。
// 这里把原生 <select> 隐藏保留作为状态源（各处已有的 .value / addEventListener
// change 逻辑完全不用改），上面盖一层自己画的按钮 + 列表，点击自绘选项时改写
// select.value 并派发 change 事件驱动原逻辑。
const _customSelectRegistry = [];
function initCustomSelect(selectEl) {
  if (!selectEl) return null;
  const trigger = document.getElementById(selectEl.id + "Trigger");
  const wrapper = document.getElementById(selectEl.id + "CustomSelect");
  const list = document.getElementById(selectEl.id + "CustomList");
  if (!trigger || !wrapper || !list) return null;
  const valueLabel = trigger.querySelector(".custom-select-value");

  function renderOptions() {
    list.innerHTML = "";
    [...selectEl.options].forEach((opt, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "custom-select-option";
      btn.setAttribute("role", "option");
      btn.id = `${selectEl.id}_option_${index}`;
      btn.textContent = opt.textContent;
      btn.setAttribute("aria-selected", opt.value === selectEl.value ? "true" : "false");
      btn.addEventListener("click", () => {
        if (selectEl.value !== opt.value) {
          selectEl.value = opt.value;
          selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
        close();
        trigger.focus();
      });
      list.appendChild(btn);
    });
  }
  function syncLabel() {
    const opt = selectEl.options[selectEl.selectedIndex];
    if (valueLabel) valueLabel.textContent = opt ? opt.textContent : "";
  }
  function isOpen() { return !list.classList.contains("hidden"); }
  function focusOption(position = "selected") {
    const options = [...list.querySelectorAll(".custom-select-option")];
    if (!options.length) return;
    let index = options.findIndex(option => option.getAttribute("aria-selected") === "true");
    if (position === "first") index = 0;
    if (position === "last") index = options.length - 1;
    options[Math.max(0, index)]?.focus();
  }
  function open(focusPosition = "") {
    _customSelectRegistry.forEach(inst => { if (inst.close !== close) inst.close(); });
    renderOptions();
    list.classList.remove("hidden");
    trigger.setAttribute("aria-expanded", "true");
    if (focusPosition) focusOption(focusPosition);
  }
  function close() {
    list.classList.add("hidden");
    trigger.setAttribute("aria-expanded", "false");
  }
  trigger.addEventListener("click", () => { isOpen() ? close() : open(); });
  trigger.addEventListener("keydown", event => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      open(event.key === "ArrowUp" || event.key === "End" ? "last" : "first");
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      isOpen() ? close() : open("selected");
    }
  });
  list.addEventListener("keydown", event => {
    const options = [...list.querySelectorAll(".custom-select-option")];
    const current = options.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      let next = current;
      if (event.key === "ArrowDown") next = (current + 1 + options.length) % options.length;
      if (event.key === "ArrowUp") next = (current - 1 + options.length) % options.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = options.length - 1;
      options[next]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      trigger.focus();
    } else if (event.key === "Tab") {
      close();
    }
  });
  selectEl.addEventListener("change", syncLabel);
  syncLabel();
  const instance = { wrapper, close, isOpen, syncLabel, renderOptions };
  _customSelectRegistry.push(instance);
  return instance;
}

// 模型字段是个特例：没有单独的下拉触发器/展开框，#model 输入框本身就是触发器——
// 点击它就弹出检测到的模型列表（跟其它 .custom-select 视觉一致，共用同一套
// 外部点击/Escape 关闭逻辑），选中后填入输入框；输入框本身依然可以手动打字输入
// 任意自定义模型名，两者不冲突。
function initModelCombobox(selectEl, inputEl) {
  if (!selectEl || !inputEl) return null;
  const list = document.getElementById(selectEl.id + "CustomList");
  if (!list) return null;

  function renderOptions() {
    list.innerHTML = "";
    [...selectEl.options].forEach(opt => {
      if (!opt.value) return; // 跳过"从检测到的模型中选择…"占位项，手动打字场景不需要它
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "custom-select-option";
      btn.setAttribute("role", "option");
      btn.textContent = opt.textContent;
      btn.setAttribute("aria-selected", opt.value === inputEl.value ? "true" : "false");
      btn.addEventListener("click", () => {
        selectEl.value = opt.value;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        close();
        inputEl.focus();
      });
      list.appendChild(btn);
    });
  }
  function isOpen() { return !list.classList.contains("hidden"); }
  function open() {
    if (![...selectEl.options].some(opt => opt.value)) return;
    _customSelectRegistry.forEach(inst => { if (inst.close !== close) inst.close(); });
    renderOptions();
    list.classList.remove("hidden");
    inputEl.setAttribute("aria-expanded", "true");
  }
  function close() {
    list.classList.add("hidden");
    inputEl.setAttribute("aria-expanded", "false");
  }
  inputEl.addEventListener("click", () => { isOpen() ? close() : open(); });
  inputEl.addEventListener("input", () => { if (isOpen()) close(); });
  inputEl.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open();
      const options = [...list.querySelectorAll(".custom-select-option")];
      (event.key === "ArrowUp" ? options.at(-1) : options[0])?.focus();
    } else if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      close();
    }
  });
  list.addEventListener("keydown", event => {
    const options = [...list.querySelectorAll(".custom-select-option")];
    const current = options.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      options[(current + delta + options.length) % options.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      inputEl.focus();
    } else if (event.key === "Tab") {
      close();
    }
  });
  const instance = { wrapper: inputEl.closest(".model-input-row") || inputEl, close, isOpen, syncLabel: () => {}, renderOptions };
  _customSelectRegistry.push(instance);
  return instance;
}

document.addEventListener("click", e => {
  _customSelectRegistry.forEach(inst => { if (inst.isOpen() && !inst.wrapper.contains(e.target)) inst.close(); });
}, true);
document.addEventListener("keydown", e => {
  if (e.key === "Escape") _customSelectRegistry.forEach(inst => inst.close());
});

const customSelects = {
  apiProvider: initCustomSelect(dom.apiProvider),
  savedApis: initCustomSelect(dom.savedApis),
  nImages: initCustomSelect(dom.nImages),
  savedSizes: initCustomSelect(dom.savedSizes),
  autoFillTemplate: initCustomSelect(dom.autoFillTemplate),
  captionAutoFillTemplate: initCustomSelect(dom.captionAutoFillTemplate),
  desktopProxyMode: initCustomSelect(dom.desktopProxyMode),
  openCodexAspectRatio: initCustomSelect(dom.openCodexAspectRatio),
  modelChoices: initModelCombobox(dom.modelChoices, dom.model),
};

dom.modelChoices?.addEventListener("change", () => {
  if (!dom.modelChoices.value) return;
  dom.model.value = dom.modelChoices.value;
  dom.model.dispatchEvent(new Event("change", { bubbles: true }));
  updateApiQuickState();
});

// ─── 状态 ──────────────────────────────────────────────────
let currentMode = "single";   // "single" | "comic" | "caption"
let panelCounter = 0;         // 分镜自增编号
let captionRowCounter = 0;    // 嵌字行自增编号
let abortController = null;   // 用于取消批量生成
const inpaintState = {
  source: null,
  sourceName: "",
  sourceMime: "",
  maskDataCanvas: document.createElement("canvas"),
  actions: [],
  redoActions: [],
  activeStroke: null,
  tool: "brush",
  maskVisible: true,
  zoomMode: "fit",
  candidates: [],
  selectedCandidate: -1,
  cropPlan: null,
  providerMode: "",
  generating: false,
  abortController: null,
  resultDataUrl: "",
};
let activeGenerationId = 0;    // 用于丢弃已取消/过期的生成结果
let importedTxtFiles = [];      // { name, content } —— 导入的多个 txt 文件
let referenceImages = [];       // { file, dataUrl, width, height } —— 多张参考图片
let generatedImageUrls = [];
let appWasBackgrounded = false;
let retryAllFailedRun = null;
let currentComicHistoryId = null; // 当前结果网格对应的漫画项目历史记录 id（新生成/恢复历史时更新），
                                    // 重试某个分镜时用它定位到要更新的那条历史记录，而不是留着旧图不管
let latestUpdateRelease = null;
let latestUpdateInfo = null;

function canScrollVertically(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const style = getComputedStyle(el);
  return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 2;
}

function scrollElementByWheelDelta(el, deltaY) {
  if (!el || !Number.isFinite(deltaY)) return false;
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  if (max <= 0) return false;
  const next = Math.max(0, Math.min(max, el.scrollTop + deltaY));
  if (next === el.scrollTop) return false;
  el.scrollTop = next;
  return true;
}

function getWheelDeltaY(event, target = null) {
  const raw = Number(event?.deltaY || 0);
  if (!Number.isFinite(raw) || raw === 0) return 0;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    const lineHeight = Number.parseFloat(getComputedStyle(target || document.body).lineHeight);
    return raw * (Number.isFinite(lineHeight) ? lineHeight : 16);
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return raw * Math.max(1, target?.clientHeight || window.innerHeight || 800);
  }
  return raw;
}

// webview_windows 转发滚轮事件时不带光标坐标（上游 #313），实测中 event.target 有时会落在
// 光标视觉位置之外的元素上（比如鼠标明明在 #modelChoices 列表里，target 却是 .input-panel 或更
// 外层的容器），导致沿 target 网上找可滚祖先时根本找不到光标真正悬停的那个嵌套滚动区域。
//
// 光靠 event.clientX/clientY 重新 hit-test 只能部分解决问题：如果这个插件转发滚轮事件时坐标
// 本身也不准（不只是 target 不准），用同一个事件自带的坐标再做一次 hit-test 还是会落在错误
// 位置——排查过多轮后确认这是真实存在的情况，不能只信任 wheel 事件自己携带的任何信息。
// 用一个独立于 wheel 事件的 mousemove 监听器持续记录"最后一次已知的真实光标位置"，鼠标移动
// 是比滚轮更基础、更不容易被插件转发链路影响的事件，优先用这个位置做 hit-test；wheel 事件自
// 带的坐标降级为第二选择，event.target 是最后兜底。
let _lastKnownPointerX = null;
let _lastKnownPointerY = null;
document.addEventListener("mousemove", e => {
  _lastKnownPointerX = e.clientX;
  _lastKnownPointerY = e.clientY;
}, { passive: true, capture: true });

function resolveWheelEventStartElement(event) {
  if (Number.isFinite(_lastKnownPointerX) && Number.isFinite(_lastKnownPointerY)) {
    const atTrackedPoint = document.elementFromPoint(_lastKnownPointerX, _lastKnownPointerY);
    if (atTrackedPoint) return atTrackedPoint;
  }
  const x = event?.clientX;
  const y = event?.clientY;
  if (Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0)) {
    const atPoint = document.elementFromPoint(x, y);
    if (atPoint) return atPoint;
  }
  return event?.target || null;
}

function isOverlayVisible(overlay) {
  return !!overlay && overlay.isConnected && !overlay.classList.contains("hidden");
}

function getVisibleBlockingOverlays() {
  // 打开的下拉列表（.custom-select-list）也算进来：就算坐标纠正最终还是没能定位到该滚动
  // 的元素，至少能靠这里的兜底逻辑拦住事件、不让它继续冒泡去滚背后的主面板——"滚不动"比
  // "滚错地方"体验上更能接受，且不会有更差的后果。
  const openCustomSelectLists = _customSelectRegistry
    .filter(inst => inst.isOpen())
    .map(inst => inst.wrapper.querySelector(".custom-select-list"))
    .filter(Boolean);
  return [dom.settingsModal, dom.historyModal, dom.bulkPromptModal, ...$$(".ask-dialog-overlay"), ...$$(".lightbox"), ...openCustomSelectLists]
    .filter(isOverlayVisible);
}

function getTopVisibleOverlay() {
  const overlays = getVisibleBlockingOverlays();
  if (!overlays.length) return null;
  return overlays.reduce((top, overlay) => {
    const topZ = Number.parseInt(getComputedStyle(top).zIndex, 10) || 0;
    const z = Number.parseInt(getComputedStyle(overlay).zIndex, 10) || 0;
    if (z > topZ) return overlay;
    if (z === topZ && top.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING) return overlay;
    return top;
  }, overlays[0]);
}

function getOverlayPrimaryScroller(overlay) {
  if (!isOverlayVisible(overlay)) return null;
  const preferred = $(".modal-card", overlay) || overlay;
  if (canScrollVertically(preferred)) return preferred;
  const descendants = $$("*", overlay);
  for (const node of descendants) {
    if (canScrollVertically(node)) return node;
  }
  return null;
}

function updateBodyScrollLock() {
  document.body.style.overflow = getTopVisibleOverlay() ? "hidden" : "";
}

function getScrollableAncestor(node) {
  let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  while (el && el !== document.body && el !== document.documentElement) {
    if (canScrollVertically(el)) return el;
    el = el.parentElement;
  }
  return null;
}

function installGlobalWheelScrollBridge() {
  window.addEventListener("wheel", event => {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (getTopVisibleOverlay()) return;
    const activeScroller = getScrollableAncestor(resolveWheelEventStartElement(event));
    if (activeScroller) return;
    const panel = dom.inputPanel;
    if (scrollElementByWheelDelta(panel, getWheelDeltaY(event, panel))) event.preventDefault();
  }, { passive: false });
}

installGlobalWheelScrollBridge();

// ─── 配置管理 ──────────────────────────────────────────────
const STORAGE_KEY = "ai_image_gen_config";
const DEFAULT_API_KEY = "ai_image_gen_default_api_id";
const OFFICIAL_API_ENDPOINT = "https://api.openai.com/v1/images/generations";
const OPENCODEX_API_ENDPOINT = "http://127.0.0.1:10100/v1/images/generations";
const OPENCODEX_HEALTH_URL = "http://127.0.0.1:10100/healthz";
const OPENCODEX_PLACEHOLDER_KEY = "opencodex-local-only";
const OPENCODEX_REQUEST_TIMEOUT_MS = 620000;
const OPENCODEX_HEALTH_CACHE_MS = 30000;
const OPENCODEX_GPT_IMAGE_2 = "gpt-image-2";
const OPENCODEX_NANO_BANANA_2 = "gemini-3.1-flash-image";
const OPENCODEX_GPT_PRIVATE_QUALITY = "medium";
const OPENCODEX_GPT_PRIVATE_MAX_PIXELS_OBSERVED = 1573770;
const OPENCODEX_GPT_PRIVATE_MAX_EDGE_OBSERVED = 2172;
const OPENCODEX_MODELS = Object.freeze([OPENCODEX_GPT_IMAGE_2, OPENCODEX_NANO_BANANA_2]);
const OPENCODEX_NANO_ASPECT_RATIOS = Object.freeze([
  "1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1",
  "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9",
]);
const OPENCODEX_CAPABILITIES = Object.freeze({
  [OPENCODEX_GPT_IMAGE_2]: Object.freeze({
    label: "GPT Image 2",
    login: "ChatGPT/Codex",
    maxReferences: 8,
    supportsInpaint: false,
    requestFields: Object.freeze(["size", "quality", "background"]),
  }),
  [OPENCODEX_NANO_BANANA_2]: Object.freeze({
    label: "Nano Banana 2",
    login: "Google Antigravity",
    maxReferences: 8,
    upstreamMaxReferences: 14,
    supportsInpaint: true,
    requestFields: Object.freeze(["aspect_ratio", "image_size"]),
  }),
});
const GRSAI_SITE_URL = "https://grsai.com/zh";
const GRSAI_API_ENDPOINT = "https://grsai.dakka.com.cn/v1/api/generate";
const API_PROVIDER_PRESETS = {
  official: { endpoint: OFFICIAL_API_ENDPOINT, labelKey: "officialApi" },
  opencodex: { endpoint: OPENCODEX_API_ENDPOINT, labelKey: "opencodexApi" },
  grsai: { endpoint: GRSAI_API_ENDPOINT, labelKey: "grsaiImageApi" },
  custom: { endpoint: "", labelKey: "customApi" },
};
const OPENAI_OFFICIAL_IMAGE_MODELS = Object.freeze([
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
]);
const OFFICIAL_IMAGE_OPTION_DEFAULTS = Object.freeze({
  quality: "auto",
  background: "auto",
  outputFormat: "png",
  outputCompression: 100,
  moderation: "auto",
  inputFidelity: "low",
});
const OPENCODEX_IMAGE_OPTION_DEFAULTS = Object.freeze({
  model: OPENCODEX_GPT_IMAGE_2,
  quality: OPENCODEX_GPT_PRIVATE_QUALITY,
  background: "auto",
  aspectRatio: "1:1",
  imageSize: "1K",
});
const USD_CNY_RATE_KEY = "ai_image_gen_usd_cny_rate_v1";
const USD_CNY_RATE_URL = "https://api.frankfurter.dev/v2/rate/USD/CNY?providers=ECB";
const OPENAI_PRICING_URL = "https://developers.openai.com/api/docs/pricing";
const USD_CNY_FALLBACK_RATE = 6.77;
const USD_CNY_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const GPT_IMAGE_2_TOKEN_USD_PER_MILLION = Object.freeze({ textInput: 5, imageInput: 8, imageOutput: 30 });
const GPT_IMAGE_2_OUTPUT_USD = Object.freeze({
  "1024x1024": Object.freeze({ low: 0.006, medium: 0.053, high: 0.211 }),
  "1024x1536": Object.freeze({ low: 0.005, medium: 0.041, high: 0.165 }),
  "1536x1024": Object.freeze({ low: 0.005, medium: 0.041, high: 0.165 }),
});
const OFFICIAL_COST_LOCALES = Object.freeze({
  "zh-CN": {
    estimatedLabel: "预计图片输出费用", calculating: "正在计算…", actualCost: "实际费用", refreshRate: "刷新汇率",
    outputOnly: "仅含图片输出，不含提示词、参考图和重试费用", customPending: "{count} 张自定义尺寸将在生成后按实际 Token 计费",
    rateDaily: "USD/CNY {rate} · ECB {date}", rateFallback: "USD/CNY {rate} · 备用汇率", rateStale: "USD/CNY {rate} · 上次更新 {date}",
    rateUpdating: "正在更新 USD/CNY…", rateUpdated: "汇率已更新：1 USD = {rate} CNY", rateFailed: "汇率更新失败，继续使用上次结果：{reason}",
    tokens: "输入 {input} / 输出 {output} Token", estimateUnavailable: "生成后显示实际费用", estimateCount: "{count} 张 · {quality}", officialPricing: "官方价格",
  },
  "zh-Hant": {
    estimatedLabel: "預估圖片輸出費用", calculating: "正在計算…", actualCost: "實際費用", refreshRate: "重新整理匯率",
    outputOnly: "僅含圖片輸出，不含提示詞、參考圖與重試費用", customPending: "{count} 張自訂尺寸將在生成後依實際 Token 計費",
    rateDaily: "USD/CNY {rate} · ECB {date}", rateFallback: "USD/CNY {rate} · 備用匯率", rateStale: "USD/CNY {rate} · 上次更新 {date}",
    rateUpdating: "正在更新 USD/CNY…", rateUpdated: "匯率已更新：1 USD = {rate} CNY", rateFailed: "匯率更新失敗，繼續使用上次結果：{reason}",
    tokens: "輸入 {input} / 輸出 {output} Token", estimateUnavailable: "生成後顯示實際費用", estimateCount: "{count} 張 · {quality}", officialPricing: "官方價格",
  },
  en: {
    estimatedLabel: "Estimated image output", calculating: "Calculating…", actualCost: "Actual cost", refreshRate: "Refresh exchange rate",
    outputOnly: "Image output only; excludes prompt, reference-image, and retry costs", customPending: "{count} custom-size image(s) will be priced from actual tokens after generation",
    rateDaily: "USD/CNY {rate} · ECB {date}", rateFallback: "USD/CNY {rate} · fallback rate", rateStale: "USD/CNY {rate} · last update {date}",
    rateUpdating: "Updating USD/CNY…", rateUpdated: "Exchange rate updated: 1 USD = {rate} CNY", rateFailed: "Exchange-rate update failed; using the last result: {reason}",
    tokens: "Input {input} / output {output} tokens", estimateUnavailable: "Actual cost shown after generation", estimateCount: "{count} image(s) · {quality}", officialPricing: "Official pricing",
  },
  ja: {
    estimatedLabel: "画像出力の予想料金", calculating: "計算中…", actualCost: "実際の料金", refreshRate: "為替レートを更新",
    outputOnly: "画像出力のみ。プロンプト、参照画像、再試行の料金は含みません", customPending: "カスタムサイズ {count} 枚は生成後に実 Token で計算します",
    rateDaily: "USD/CNY {rate} · ECB {date}", rateFallback: "USD/CNY {rate} · 予備レート", rateStale: "USD/CNY {rate} · 最終更新 {date}",
    rateUpdating: "USD/CNY を更新中…", rateUpdated: "為替レート更新：1 USD = {rate} CNY", rateFailed: "為替更新に失敗したため前回値を使用します：{reason}",
    tokens: "入力 {input} / 出力 {output} Token", estimateUnavailable: "生成後に実料金を表示", estimateCount: "{count} 枚 · {quality}", officialPricing: "公式料金",
  },
  ko: {
    estimatedLabel: "예상 이미지 출력 비용", calculating: "계산 중…", actualCost: "실제 비용", refreshRate: "환율 새로고침",
    outputOnly: "이미지 출력 비용만 포함하며 프롬프트, 참고 이미지, 재시도 비용은 제외", customPending: "사용자 크기 {count}장은 생성 후 실제 토큰으로 계산됩니다",
    rateDaily: "USD/CNY {rate} · ECB {date}", rateFallback: "USD/CNY {rate} · 예비 환율", rateStale: "USD/CNY {rate} · 마지막 업데이트 {date}",
    rateUpdating: "USD/CNY 업데이트 중…", rateUpdated: "환율 업데이트: 1 USD = {rate} CNY", rateFailed: "환율 업데이트 실패, 이전 값을 사용합니다: {reason}",
    tokens: "입력 {input} / 출력 {output} 토큰", estimateUnavailable: "생성 후 실제 비용 표시", estimateCount: "{count}장 · {quality}", officialPricing: "공식 요금",
  },
});
let officialRateRefreshPromise = null;
let officialCostUpdateTimer = null;

function officialCostText(key, vars = {}) {
  const table = OFFICIAL_COST_LOCALES[currentLanguage] || OFFICIAL_COST_LOCALES["zh-CN"];
  return interpolate(table[key] || OFFICIAL_COST_LOCALES["zh-CN"][key] || key, vars);
}

function loadUsdCnyRateState() {
  try {
    const saved = JSON.parse(localStorage.getItem(USD_CNY_RATE_KEY) || "{}");
    const rate = Number(saved.rate);
    if (Number.isFinite(rate) && rate >= 4 && rate <= 10) return { ...saved, rate };
  } catch {}
  return { rate: USD_CNY_FALLBACK_RATE, rateDate: "", fetchedAt: 0, source: "fallback" };
}

function formatCny(value, prefix = "") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  return `${prefix}¥${amount.toLocaleString(localeTagForCurrentLanguage(), { minimumFractionDigits: amount < 1 ? 3 : 2, maximumFractionDigits: amount < 1 ? 4 : 2 })}`;
}

function formatUsd(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  return `$${amount.toFixed(amount < 0.01 ? 5 : 4)}`;
}

function formatTokenCount(value) {
  return Math.max(0, Math.round(Number(value) || 0)).toLocaleString(localeTagForCurrentLanguage());
}

function getOfficialEstimateItems() {
  try {
    if (currentMode === "comic") {
      const panels = collectPanels();
      const ready = panels.filter(panel => String(panel.prompt || "").trim());
      return (ready.length ? ready : panels).map(panel => panel.size || getSelectedSize());
    }
    if (currentMode === "caption") {
      const rows = collectCaptionRows();
      const ready = rows.filter(row => row.reference && String(row.captionText || "").trim());
      return (ready.length ? ready : rows).map(row => row.reference?.width && row.reference?.height
        ? `${row.reference.width}x${row.reference.height}`
        : getSelectedSize());
    }
  } catch {}
  const count = Math.max(1, Math.min(10, Number(dom.nImages?.value) || 1));
  return Array.from({ length: count }, () => getSelectedSize());
}

function getOfficialOutputUsdRange(size, quality) {
  const table = GPT_IMAGE_2_OUTPUT_USD[String(size || "").toLowerCase()];
  if (!table) return null;
  if (quality === "auto") return { min: table.low, max: table.high };
  const value = table[quality];
  return Number.isFinite(value) ? { min: value, max: value } : null;
}

function updateOfficialRateStatus(state = loadUsdCnyRateState(), overrideText = "") {
  if (!dom.officialRateStatus) return;
  if (overrideText) {
    dom.officialRateStatus.textContent = overrideText;
    return;
  }
  const rate = Number(state.rate).toFixed(4);
  if (state.source === "fallback" || !state.rateDate) {
    dom.officialRateStatus.textContent = officialCostText("rateFallback", { rate });
  } else if (Date.now() - Number(state.fetchedAt || 0) > USD_CNY_REFRESH_INTERVAL_MS * 2) {
    dom.officialRateStatus.textContent = officialCostText("rateStale", { rate, date: state.rateDate });
  } else {
    dom.officialRateStatus.textContent = officialCostText("rateDaily", { rate, date: state.rateDate });
  }
}

function updateOfficialCostSummary() {
  if (!dom.officialCostSummary) return;
  const provider = dom.apiProvider?.value || inferApiProvider(dom.apiEndpoint?.value || "");
  const visible = provider === "official" && officialImageModelFamily(dom.model?.value || "gpt-image-2") === "gpt-image-2";
  dom.officialCostSummary.classList.toggle("hidden", !visible);
  if (!visible) return;

  const rateState = loadUsdCnyRateState();
  const quality = getOfficialImageOptions().quality;
  const items = getOfficialEstimateItems();
  let minUsd = 0;
  let maxUsd = 0;
  let unknown = 0;
  items.forEach(size => {
    const range = getOfficialOutputUsdRange(size, quality);
    if (!range) { unknown++; return; }
    minUsd += range.min;
    maxUsd += range.max;
  });

  dom.officialCostLabel.textContent = officialCostText("estimatedLabel");
  const qualityLabel = quality === "auto" ? cleanText("optionAuto") : cleanText(`option${quality[0].toUpperCase()}${quality.slice(1)}`);
  if (items.length && unknown < items.length) {
    const minCny = minUsd * rateState.rate;
    const maxCny = maxUsd * rateState.rate;
    dom.officialEstimatedCost.textContent = Math.abs(maxCny - minCny) < 0.00005
      ? formatCny(minCny)
      : `${formatCny(minCny)}–${formatCny(maxCny)}`;
  } else {
    dom.officialEstimatedCost.textContent = officialCostText("estimateUnavailable");
  }
  const lines = [officialCostText("estimateCount", { count: items.length || 1, quality: qualityLabel }), officialCostText("outputOnly")];
  if (unknown) lines.push(officialCostText("customPending", { count: unknown }));
  dom.officialCostBreakdown.textContent = lines.join(" · ");
  updateOfficialRateStatus(rateState);
  if (dom.refreshOfficialRate) {
    dom.refreshOfficialRate.title = officialCostText("refreshRate");
    dom.refreshOfficialRate.setAttribute("aria-label", officialCostText("refreshRate"));
  }
  if (dom.officialPricingLink) {
    dom.officialPricingLink.innerHTML = `${icon("web")}<span>${officialCostText("officialPricing")}</span>`;
    dom.officialPricingLink.title = officialCostText("officialPricing");
  }
}

function scheduleOfficialCostSummaryUpdate() {
  clearTimeout(officialCostUpdateTimer);
  officialCostUpdateTimer = setTimeout(updateOfficialCostSummary, 40);
}

async function refreshUsdCnyRate({ force = false, announce = false } = {}) {
  const cached = loadUsdCnyRateState();
  if (!force && cached.source !== "fallback" && Date.now() - Number(cached.fetchedAt || 0) < USD_CNY_REFRESH_INTERVAL_MS) {
    updateOfficialCostSummary();
    return cached;
  }
  if (officialRateRefreshPromise) return officialRateRefreshPromise;
  officialRateRefreshPromise = (async () => {
    dom.refreshOfficialRate?.classList.add("is-loading");
    if (dom.refreshOfficialRate) dom.refreshOfficialRate.disabled = true;
    updateOfficialRateStatus(cached, officialCostText("rateUpdating"));
    try {
      const response = await smartFetch(USD_CNY_RATE_URL, {
        headers: { "Accept": "application/json" },
        nativeTimeoutMs: 15000,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const rate = Number(payload?.rate);
      if (!Number.isFinite(rate) || rate < 4 || rate > 10) throw new Error("USD/CNY rate is invalid");
      const next = {
        rate,
        rateDate: String(payload.date || new Date().toISOString().slice(0, 10)),
        fetchedAt: Date.now(),
        source: "ECB/Frankfurter",
      };
      localStorage.setItem(USD_CNY_RATE_KEY, JSON.stringify(next));
      updateOfficialCostSummary();
      if (announce) showStatus(officialCostText("rateUpdated", { rate: rate.toFixed(4) }), "success");
      return next;
    } catch (err) {
      updateOfficialCostSummary();
      if (announce) showStatus(officialCostText("rateFailed", { reason: err.message || err }), "error");
      return cached;
    } finally {
      dom.refreshOfficialRate?.classList.remove("is-loading");
      if (dom.refreshOfficialRate) dom.refreshOfficialRate.disabled = false;
      officialRateRefreshPromise = null;
    }
  })();
  return officialRateRefreshPromise;
}

function normalizeOfficialUsage(data) {
  const raw = data?.usage;
  if (!raw || typeof raw !== "object") return null;
  const inputDetails = raw.input_tokens_details || {};
  const outputDetails = raw.output_tokens_details || {};
  const textInputTokens = Math.max(0, Number(inputDetails.text_tokens) || 0);
  const imageInputTokens = Math.max(0, Number(inputDetails.image_tokens) || 0);
  const inputTokens = Math.max(0, Number(raw.input_tokens) || textInputTokens + imageInputTokens);
  const outputTokens = Math.max(0, Number(outputDetails.image_tokens) || Number(raw.output_tokens) || 0);
  if (!inputTokens && !outputTokens) return null;
  return {
    inputTokens: Math.round(inputTokens),
    textInputTokens: Math.round(textInputTokens),
    imageInputTokens: Math.round(imageInputTokens),
    outputTokens: Math.round(outputTokens),
    totalTokens: Math.round(Number(raw.total_tokens) || inputTokens + outputTokens),
  };
}

function buildOfficialBilling(data) {
  if (officialImageModelFamily(data?._officialModel) !== "gpt-image-2") return null;
  const usage = normalizeOfficialUsage(data);
  if (!usage) return null;
  const unclassifiedInputTokens = Math.max(0, usage.inputTokens - usage.textInputTokens - usage.imageInputTokens);
  let textInputTokens = usage.textInputTokens;
  let imageInputTokens = usage.imageInputTokens;
  if (unclassifiedInputTokens && data?._officialHasReference === false) textInputTokens += unclassifiedInputTokens;
  const unknownInputTokens = data?._officialHasReference === false ? 0 : unclassifiedInputTokens;
  const usd = (
    textInputTokens * GPT_IMAGE_2_TOKEN_USD_PER_MILLION.textInput
    + imageInputTokens * GPT_IMAGE_2_TOKEN_USD_PER_MILLION.imageInput
    + usage.outputTokens * GPT_IMAGE_2_TOKEN_USD_PER_MILLION.imageOutput
  ) / 1_000_000;
  const rateState = loadUsdCnyRateState();
  return {
    usage,
    usd,
    cny: usd * rateState.rate,
    exchangeRate: rateState.rate,
    rateDate: rateState.rateDate || "",
    rateSource: rateState.source || "fallback",
    approximate: unknownInputTokens > 0,
    unknownInputTokens,
  };
}

function renderResultBilling(card, billing) {
  if (!card || !billing?.usage || !Number.isFinite(Number(billing.cny))) return;
  const meta = document.createElement("div");
  meta.className = "result-cost-meta";
  const value = document.createElement("strong");
  value.textContent = `${officialCostText("actualCost")} ${formatCny(billing.cny, billing.approximate ? "≥" : "")}`;
  const tokens = document.createElement("span");
  tokens.textContent = officialCostText("tokens", {
    input: formatTokenCount(billing.usage.inputTokens),
    output: formatTokenCount(billing.usage.outputTokens),
  });
  meta.title = `${formatUsd(billing.usd)} · USD/CNY ${Number(billing.exchangeRate).toFixed(4)}${billing.rateDate ? ` · ${billing.rateDate}` : ""}`;
  meta.append(value, tokens);
  card.appendChild(meta);
}

function sumBillingCny(items = []) {
  const values = items.map(item => Number(item?.billing?.cny)).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function isOpenAiOfficialImageModelId(value) {
  const id = String(value || "").trim();
  return /^(?:gpt-image-2|gpt-image-1\.5|gpt-image-1-mini|gpt-image-1)(?:-\d{4}-\d{2}-\d{2})?$/i.test(id);
}

function officialImageModelFamily(value) {
  const id = String(value || "").trim().toLowerCase();
  if (!isOpenAiOfficialImageModelId(id)) return "";
  if (id.startsWith("gpt-image-2")) return "gpt-image-2";
  if (id.startsWith("gpt-image-1.5")) return "gpt-image-1.5";
  if (id.startsWith("gpt-image-1-mini")) return "gpt-image-1-mini";
  return "gpt-image-1";
}

function normalizeOfficialImageOptions(value = {}) {
  const pick = (candidate, allowed, fallback) => allowed.includes(candidate) ? candidate : fallback;
  return {
    quality: pick(value.quality, ["auto", "low", "medium", "high"], OFFICIAL_IMAGE_OPTION_DEFAULTS.quality),
    background: pick(value.background, ["auto", "opaque", "transparent"], OFFICIAL_IMAGE_OPTION_DEFAULTS.background),
    outputFormat: pick(value.outputFormat || value.output_format, ["png", "jpeg", "webp"], OFFICIAL_IMAGE_OPTION_DEFAULTS.outputFormat),
    outputCompression: Math.min(100, Math.max(0, Math.round(Number(value.outputCompression ?? value.output_compression ?? OFFICIAL_IMAGE_OPTION_DEFAULTS.outputCompression) || 0))),
    moderation: pick(value.moderation, ["auto", "low"], OFFICIAL_IMAGE_OPTION_DEFAULTS.moderation),
    inputFidelity: pick(value.inputFidelity || value.input_fidelity, ["low", "high"], OFFICIAL_IMAGE_OPTION_DEFAULTS.inputFidelity),
  };
}

function getOfficialImageOptions() {
  return normalizeOfficialImageOptions({
    quality: dom.officialQuality?.value,
    background: dom.officialBackground?.value,
    outputFormat: dom.officialOutputFormat?.value,
    outputCompression: dom.officialOutputCompression?.value,
    moderation: dom.officialModeration?.value,
    inputFidelity: dom.officialInputFidelity?.value,
  });
}

function setProviderSegmentValue(controlId, value) {
  const input = dom[controlId];
  if (input) input.value = value;
  const group = document.querySelector(`[data-provider-control="${controlId}"]`);
  group?.querySelectorAll("button[data-value]").forEach(button => {
    const selected = button.dataset.value === value;
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    button.classList.toggle("active", selected);
  });
}

function applyOfficialImageOptions(value = {}) {
  const options = normalizeOfficialImageOptions(value);
  setProviderSegmentValue("officialQuality", options.quality);
  setProviderSegmentValue("officialBackground", options.background);
  setProviderSegmentValue("officialOutputFormat", options.outputFormat);
  setProviderSegmentValue("officialModeration", options.moderation);
  setProviderSegmentValue("officialInputFidelity", options.inputFidelity);
  if (dom.officialOutputCompression) dom.officialOutputCompression.value = String(options.outputCompression);
  if (dom.officialCompressionValue) dom.officialCompressionValue.textContent = String(options.outputCompression);
  updateOfficialOptionAvailability();
}

function normalizeOpenCodexImageOptions(value = {}) {
  const model = OPENCODEX_MODELS.includes(value.model) ? value.model : OPENCODEX_IMAGE_OPTION_DEFAULTS.model;
  return {
    model,
    quality: model === OPENCODEX_GPT_IMAGE_2
      ? OPENCODEX_GPT_PRIVATE_QUALITY
      : (["auto", "low", "medium", "high"].includes(value.quality) ? value.quality : OPENCODEX_IMAGE_OPTION_DEFAULTS.quality),
    background: ["auto", "opaque"].includes(value.background) ? value.background : OPENCODEX_IMAGE_OPTION_DEFAULTS.background,
    aspectRatio: OPENCODEX_NANO_ASPECT_RATIOS.includes(value.aspectRatio)
      ? value.aspectRatio
      : OPENCODEX_IMAGE_OPTION_DEFAULTS.aspectRatio,
    imageSize: ["512", "1K", "2K", "4K"].includes(value.imageSize)
      ? value.imageSize
      : OPENCODEX_IMAGE_OPTION_DEFAULTS.imageSize,
  };
}

function getOpenCodexImageOptions() {
  return normalizeOpenCodexImageOptions({
    model: dom.openCodexModel?.value || dom.model?.value,
    quality: dom.openCodexQuality?.value,
    background: dom.openCodexBackground?.value,
    aspectRatio: dom.openCodexAspectRatio?.value,
    imageSize: dom.openCodexImageSize?.value,
  });
}

function applyOpenCodexImageOptions(value = {}) {
  const options = normalizeOpenCodexImageOptions(value);
  setProviderSegmentValue("openCodexModel", options.model);
  setProviderSegmentValue("openCodexQuality", options.quality);
  setProviderSegmentValue("openCodexBackground", options.background);
  setProviderSegmentValue("openCodexImageSize", options.imageSize);
  if (dom.openCodexAspectRatio) dom.openCodexAspectRatio.value = options.aspectRatio;
  customSelects?.openCodexAspectRatio?.syncLabel();
  updateOpenCodexOptionAvailability();
}

function updateOpenCodexOptionAvailability() {
  const options = getOpenCodexImageOptions();
  const model = options.model;
  const capability = OPENCODEX_CAPABILITIES[model] || OPENCODEX_CAPABILITIES[OPENCODEX_GPT_IMAGE_2];
  const isNano = model === OPENCODEX_NANO_BANANA_2;
  if (!isNano) setProviderSegmentValue("openCodexQuality", OPENCODEX_GPT_PRIVATE_QUALITY);
  document.querySelectorAll('[data-provider-control="openCodexQuality"] button[data-value]').forEach(button => {
    const fixedByPrivateUpstream = !isNano && button.dataset.value !== OPENCODEX_GPT_PRIVATE_QUALITY;
    button.disabled = fixedByPrivateUpstream;
    button.setAttribute("aria-disabled", String(fixedByPrivateUpstream));
  });
  document.querySelectorAll(".opencodex-gpt-option").forEach(element => element.classList.toggle("hidden", isNano));
  document.querySelectorAll(".opencodex-nano-option").forEach(element => element.classList.toggle("hidden", !isNano));
  if (dom.model && isOpenCodexSelected()) dom.model.value = model;
  updateInpaintAvailability();
  if ($("#openCodexFacts")) {
    $("#openCodexFacts").textContent = isNano
      ? interpolate(cleanText("openCodexNanoFacts"), { concurrency: getOpenCodexConcurrency(options) })
      : cleanText("opencodexFacts");
  }
  if ($("#openCodexCapabilityNote")) {
    $("#openCodexCapabilityNote").textContent = isNano
      ? cleanText("openCodexNanoCapability")
      : cleanText("opencodexCapability");
  }
  updateSizePolicyUi();
  if (dom.apiQuickMeta && isOpenCodexSelected()) updateApiQuickState();
}

const SIZE_POLICY_TEXT = Object.freeze({
  "zh-CN": Object.freeze({
    official: "gpt-image-2 支持满足约束的任意尺寸；带“官方”的七项是 OpenAI 常用预设。",
    opencodex: "Codex 私有额度路径实测固定约 157 万像素；所选尺寸用于提示方向和比例，生成后请查看实际尺寸。",
    nano: "Nano Banana 2 只使用上方的官方“比例 × 分辨率档位”；这里的像素尺寸不会发送。",
    generic: "预设尺寸会作为像素尺寸发送；自定义接口是否支持由服务端决定。",
  }),
  "zh-Hant": Object.freeze({
    official: "gpt-image-2 支援符合限制的任意尺寸；標示「官方」的七項是 OpenAI 常用預設。",
    opencodex: "Codex 私有額度路徑實測固定約 157 萬像素；所選尺寸用於提示方向與比例，請以生成後的實際尺寸為準。",
    nano: "Nano Banana 2 只使用上方官方的「比例 × 解析度檔位」；此處像素尺寸不會傳送。",
    generic: "預設尺寸會作為像素尺寸傳送；自訂介面是否支援由伺服器決定。",
  }),
  en: Object.freeze({
    official: "gpt-image-2 accepts any compliant size. The seven Official choices are OpenAI's popular presets.",
    opencodex: "The Codex private quota route was measured at about 1.57 MP. The selected size guides orientation and ratio; check the decoded size.",
    nano: "Nano Banana 2 uses only the official ratio and resolution tier above. Pixel presets here are not sent.",
    generic: "Pixel dimensions are sent as requested. Custom-server support depends on that server.",
  }),
  ja: Object.freeze({
    official: "gpt-image-2 は制約を満たす任意サイズに対応します。「公式」の7項目は OpenAI の代表的なプリセットです。",
    opencodex: "Codex の非公開クォータ経路は実測で約 157 万画素固定です。選択サイズは向きと比率の指示に使われ、生成後の実寸を正とします。",
    nano: "Nano Banana 2 は上の公式「比率 × 解像度段階」のみを使用し、ここのピクセル値は送信しません。",
    generic: "ピクセル寸法を要求値として送信します。対応可否は接続先サーバーによります。",
  }),
  ko: Object.freeze({
    official: "gpt-image-2는 제약을 만족하는 임의 크기를 지원합니다. '공식' 7개 항목은 OpenAI 권장 프리셋입니다.",
    opencodex: "Codex 비공개 할당량 경로는 실측상 약 157만 화소로 고정됩니다. 선택 크기는 방향과 비율 안내에 사용되며 실제 크기를 확인해야 합니다.",
    nano: "Nano Banana 2는 위의 공식 '비율 × 해상도 단계'만 사용하며 이 픽셀 크기는 전송하지 않습니다.",
    generic: "픽셀 크기를 요청값으로 전송합니다. 지원 여부는 연결한 서버에 따라 다릅니다.",
  }),
});

function updateSizePolicyUi() {
  const provider = dom.apiProvider?.value || inferApiProvider(dom.apiEndpoint?.value || "");
  const isNano = provider === "opencodex" && getOpenCodexImageOptions().model === OPENCODEX_NANO_BANANA_2;
  const isCaptionMode = !!dom.modeTabs?.querySelector('[data-mode="caption"].active');
  if (dom.globalSizeField) dom.globalSizeField.classList.toggle("hidden", isCaptionMode || isNano);
  if (!dom.sizePolicyHint) return;
  const language = SIZE_POLICY_TEXT[currentLanguage] || SIZE_POLICY_TEXT["zh-CN"];
  const key = isNano
    ? "nano"
    : provider === "official" && officialImageModelFamily(dom.model?.value || "") === "gpt-image-2"
      ? "official"
      : provider === "opencodex"
        ? "opencodex"
        : "generic";
  dom.sizePolicyHint.textContent = language[key];
}

function getOpenCodexConcurrency(options = getOpenCodexImageOptions()) {
  if (options.model !== OPENCODEX_NANO_BANANA_2) return 5;
  if (options.imageSize === "4K") return 1;
  if (options.imageSize === "2K") return 3;
  return 5;
}

function greatestCommonDivisor(a, b) {
  let left = Math.abs(Math.trunc(a));
  let right = Math.abs(Math.trunc(b));
  while (right) [left, right] = [right, left % right];
  return left || 1;
}

function getOpenCodexGptAspectTarget(size) {
  const match = String(size || "").trim().match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return null;
  const divisor = greatestCommonDivisor(width, height);
  return {
    width,
    height,
    ratio: `${width / divisor}:${height / divisor}`,
    orientation: width === height ? "square" : width > height ? "horizontal" : "vertical",
  };
}

function addOpenCodexGptAspectInstruction(prompt, size) {
  const source = String(prompt || "").trim();
  const target = getOpenCodexGptAspectTarget(size);
  if (!target) return source;
  return `${source}\n\nCanvas requirement: compose the image in a ${target.orientation} ${target.ratio} aspect ratio. Keep the complete scene inside this frame.`;
}

function updateOfficialOptionAvailability() {
  const model = String(dom.model?.value || "gpt-image-2").trim().toLowerCase();
  const family = officialImageModelFamily(model);
  const isGptImage2 = family === "gpt-image-2";
  const isMini = family === "gpt-image-1-mini";
  const transparent = document.querySelector('[data-provider-control="officialBackground"] button[data-value="transparent"]');
  if (transparent) transparent.disabled = isGptImage2;
  if (isGptImage2 && dom.officialBackground?.value === "transparent") {
    setProviderSegmentValue("officialBackground", "auto");
  }
  const jpeg = document.querySelector('[data-provider-control="officialOutputFormat"] button[data-value="jpeg"]');
  if (jpeg) jpeg.disabled = dom.officialBackground?.value === "transparent";
  const fidelityDisabled = isGptImage2 || isMini;
  dom.officialInputFidelityField?.classList.toggle("is-disabled", fidelityDisabled);
  document.querySelectorAll('[data-provider-control="officialInputFidelity"] button').forEach(button => {
    button.disabled = fidelityDisabled;
  });
  if (isGptImage2) setProviderSegmentValue("officialInputFidelity", "high");
  else if (isMini) setProviderSegmentValue("officialInputFidelity", "low");

  if (dom.officialBackground?.value === "transparent" && dom.officialOutputFormat?.value === "jpeg") {
    setProviderSegmentValue("officialOutputFormat", "png");
  }
  const compressed = ["jpeg", "webp"].includes(dom.officialOutputFormat?.value);
  dom.officialCompressionField?.classList.toggle("hidden", !compressed);
  if (dom.officialCapabilityNote) {
    const key = isGptImage2 ? "officialCapabilityGptImage2" : isMini ? "officialCapabilityMini" : model ? "officialCapabilityLegacy" : "officialCapabilityDefault";
    dom.officialCapabilityNote.textContent = cleanText(key);
  }
  updateSizePolicyUi();
  updateInpaintAvailability();
}

function updateProviderPanelVisibility(provider = dom.apiProvider?.value || "custom") {
  dom.officialProviderPanel?.classList.toggle("hidden", provider !== "official");
  dom.openCodexProviderPanel?.classList.toggle("hidden", provider !== "opencodex");
  dom.grsaiProviderPanel?.classList.toggle("hidden", provider !== "grsai");
  dom.customProviderPanel?.classList.toggle("hidden", provider !== "custom");
  dom.grsaiRetrySettings?.classList.toggle("hidden", provider !== "grsai");
  if (provider === "official") updateOfficialOptionAvailability();
  updateSizePolicyUi();
  updateInpaintAvailability();
}

function updateProviderOptionsLanguage() {
  const textKeys = {
    officialProviderTitle: "officialPanelTitle", officialProviderHint: "officialPanelHint",
    officialQualityLabel: "officialQuality", officialQualityHint: "officialQualityHint",
    officialBackgroundLabel: "officialBackground", officialBackgroundHint: "officialBackgroundHint",
    officialOutputFormatLabel: "officialOutputFormat", officialOutputFormatHint: "officialOutputFormatHint",
    officialCompressionLabel: "officialCompression", officialCompressionHint: "officialCompressionHint",
    officialModerationLabel: "officialModeration", officialModerationHint: "officialModerationHint",
    officialInputFidelityLabel: "officialInputFidelity", officialInputFidelityHint: "officialInputFidelityHint",
    openCodexProviderTitle: "opencodexPanelTitle", openCodexProviderHint: "opencodexPanelHint",
    openCodexModelLabel: "openCodexModel", openCodexModelHint: "openCodexModelHint",
    openCodexQualityLabel: "opencodexQuality", openCodexQualityHint: "opencodexQualityHint",
    openCodexBackgroundLabel: "opencodexBackground", openCodexBackgroundHint: "opencodexBackgroundHint",
    openCodexAspectRatioLabel: "openCodexAspectRatio", openCodexAspectRatioHint: "openCodexAspectRatioHint",
    openCodexImageSizeLabel: "openCodexImageSize", openCodexImageSizeHint: "openCodexImageSizeHint",
    openCodexFacts: "opencodexFacts", openCodexCapabilityNote: "opencodexCapability",
    grsaiProviderTitle: "grsaiPanelTitle", grsaiProviderHint: "grsaiPanelHint", grsaiNodeHint: "grsaiNodeHint",
    grsaiWebsite: "grsaiWebsiteLabel", customProviderTitle: "customPanelTitle", customProviderHint: "customPanelHint",
    grsaiRetryTitle: "grsaiRetryTitle",
  };
  Object.entries(textKeys).forEach(([id, key]) => setText(`#${id}`, key));
  const nanoRatioHint = {
    "zh-CN": "只发送 Nano Banana 2 官方支持的比例。",
    "zh-Hant": "只傳送 Nano Banana 2 官方支援的比例。",
    en: "Only official Nano Banana 2 aspect ratios are sent.",
    ja: "Nano Banana 2 が公式対応する比率のみ送信します。",
    ko: "Nano Banana 2 공식 지원 비율만 전송합니다.",
  }[currentLanguage];
  if ($("#openCodexAspectRatioHint")) $("#openCodexAspectRatioHint").textContent = nanoRatioHint;
  const optionKeys = { auto: "optionAuto", low: "optionLow", medium: "optionMedium", high: "optionHigh", opaque: "optionOpaque", transparent: "optionTransparent" };
  document.querySelectorAll(".provider-segments button[data-value]").forEach(button => {
    const key = optionKeys[button.dataset.value];
    if (key) button.textContent = cleanText(key);
  });
  document.querySelectorAll('[data-provider-control="officialOutputFormat"] button').forEach(button => {
    button.textContent = button.dataset.value === "jpeg" ? "JPEG" : button.dataset.value.toUpperCase();
  });
  const openCodexQualityLabels = {
    "zh-CN": { auto: "自动", low: "草稿", medium: "标准", high: "高质量" },
    "zh-Hant": { auto: "自動", low: "草稿", medium: "標準", high: "高品質" },
    en: { auto: "Auto", low: "Draft", medium: "Standard", high: "High quality" },
    ja: { auto: "自動", low: "下書き", medium: "標準", high: "高品質" },
    ko: { auto: "자동", low: "초안", medium: "표준", high: "고품질" },
  }[currentLanguage] || {};
  document.querySelectorAll('[data-provider-control="openCodexQuality"] button[data-value]').forEach(button => {
    button.textContent = openCodexQualityLabels[button.dataset.value] || button.dataset.value;
  });
  customSelects.openCodexAspectRatio?.syncLabel();
  setButtonText(dom.testOpenCodexHealth, "refresh", "opencodexHealthCheck");
  setButtonText(dom.openInpaintFromFile, "mask", "openInpaint");
  setButtonText($("#useGrsaiEndpoint"), "spark", "useGrsaiEndpoint");
  updateOfficialOptionAvailability();
  updateOpenCodexOptionAvailability();
  setOpenCodexHealthState(openCodexHealthState, openCodexHealthDetail);
  updateInpaintLanguage();
}

function updateInpaintLanguage() {
  setText("#inpaintTitle", "inpaintTitle");
  setText("#inpaintDisclosure", "inpaintDisclosure");
  setButtonText(dom.inpaintChooseSource, "image", "inpaintChooseSource");
  setText("#inpaintPromptLabel", "inpaintPromptLabel");
  setButtonText(dom.generateInpaint, "spark", "inpaintGenerate");
  setButtonText(dom.applyInpaint, "save", "inpaintApply");
  setButtonText(dom.cancelInpaintGeneration, "x", "cancelGeneration");
  if (dom.inpaintPrompt) dom.inpaintPrompt.placeholder = cleanText("inpaintPromptLabel");
  const hasSource = Number(dom.inpaintBaseCanvas?.width || 0) > 0;
  const isGenerating = !dom.cancelInpaintGeneration?.classList.contains("hidden");
  if (dom.inpaintSourceMeta && !hasSource) dom.inpaintSourceMeta.textContent = cleanText("inpaintNoSource");
  if (dom.inpaintStatus && !hasSource && !isGenerating) {
    dom.inpaintStatus.textContent = cleanText("inpaintInitial");
  }
  updateInpaintAvailability();
}

let openCodexHealthState = "idle";
let openCodexHealthCheckedAt = 0;
let openCodexHealthVersion = "";
let openCodexHealthDetail = "";
let openCodexHealthPromise = null;

function isOpenCodexSelected() {
  return (dom.apiProvider?.value || inferApiProvider(dom.apiEndpoint?.value || "")) === "opencodex";
}

function getInpaintProviderMode() {
  const provider = dom.apiProvider?.value || inferApiProvider(dom.apiEndpoint?.value || "");
  const model = String(dom.model?.value || "").trim();
  if (provider === "official" && officialImageModelFamily(model) === "gpt-image-2") {
    return "official-native-mask";
  }
  if (provider === "opencodex" && getOpenCodexImageOptions().model === OPENCODEX_GPT_IMAGE_2) {
    return "opencodex-local-mask";
  }
  return "";
}

function updateInpaintAvailability() {
  const mode = getInpaintProviderMode();
  if (dom.openInpaintFromFile) {
    dom.openInpaintFromFile.disabled = !mode;
    dom.openInpaintFromFile.title = mode ? cleanText("openInpaint") : cleanText("inpaintRequiresGptImage2");
  }
  if (dom.inpaintDisclosure) {
    dom.inpaintDisclosure.textContent = cleanText(
      mode === "official-native-mask" ? "inpaintOfficialDisclosure" : "inpaintOpenCodexDisclosure"
    );
  }
  return mode;
}

function setOpenCodexHealthState(state, detail = "") {
  openCodexHealthState = state;
  openCodexHealthDetail = detail;
  if (dom.openCodexHealthStatus) {
    dom.openCodexHealthStatus.dataset.state = state;
    const text = state === "checking"
      ? cleanText("opencodexHealthChecking")
      : state === "ready"
        ? interpolate(cleanText("opencodexHealthReady"), { version: openCodexHealthVersion || detail || "OK" })
        : state === "error"
          ? interpolate(cleanText("opencodexHealthFailed"), { reason: detail || "OpenCodex" })
          : cleanText("opencodexHealthIdle");
    dom.openCodexHealthStatus.textContent = text;
  }
  syncOpenCodexGenerateAvailability();
}

function syncOpenCodexGenerateAvailability() {
  if (!dom.generateBtn || dom.generateBtn.classList.contains("is-cancel")) return;
  dom.generateBtn.disabled = isOpenCodexSelected() && openCodexHealthState !== "ready";
}

async function checkOpenCodexHealth({ announce = false, force = true } = {}) {
  if (!isOpenCodexSelected()) return true;
  if (!force && openCodexHealthState === "ready" && Date.now() - openCodexHealthCheckedAt < OPENCODEX_HEALTH_CACHE_MS) {
    syncOpenCodexGenerateAvailability();
    return true;
  }
  if (openCodexHealthPromise) return openCodexHealthPromise;
  setOpenCodexHealthState("checking");
  if (dom.testOpenCodexHealth) dom.testOpenCodexHealth.disabled = true;
  openCodexHealthPromise = (async () => {
    try {
      const response = await smartFetch(OPENCODEX_HEALTH_URL, {
        headers: { "Accept": "application/json" },
        nativeTimeoutMs: 5000,
        forceDirectProxy: true,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json().catch(() => ({}));
      if (payload?.status && payload.status !== "ok") throw new Error(payload.message || payload.status);
      openCodexHealthVersion = String(payload?.version || "OK");
      openCodexHealthCheckedAt = Date.now();
      setOpenCodexHealthState("ready");
      if (announce) showStatus(interpolate(cleanText("opencodexHealthReady"), { version: openCodexHealthVersion }), "success");
      return true;
    } catch (err) {
      openCodexHealthVersion = "";
      openCodexHealthCheckedAt = 0;
      const reason = err?.message === "Failed to fetch"
        ? "OpenCodex 未启动；请先启动 OpenCodex，或执行 ocx ensure"
        : String(err?.message || err || "OpenCodex");
      setOpenCodexHealthState("error", reason);
      if (announce) showStatus(interpolate(cleanText("opencodexHealthFailed"), { reason }), "error");
      return false;
    } finally {
      if (dom.testOpenCodexHealth) dom.testOpenCodexHealth.disabled = false;
      openCodexHealthPromise = null;
    }
  })();
  return openCodexHealthPromise;
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    if (saved?.endpoint) {
      const normalized = normalizeApiConfig(saved);
      if (!saved.id) localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return normalized;
    }
    return getDefaultApiConfig() || saved || {};
  } catch {
    return getDefaultApiConfig() || {};
  }
}
function secureStorageBridgeAvailable() {
  return window.__AI_GEN_SECURE_STORAGE === true && typeof FlutterDownload !== "undefined" && !!FlutterDownload.postMessage;
}

function secureApiKeyName(id) {
  return `api_key:${String(id || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 160)}`;
}

let secureStorageOperationChain = Promise.resolve();
let apiConfigApplySequence = 0;

function queueSecureStorageOperation(operation) {
  const next = secureStorageOperationChain.catch(() => {}).then(operation);
  secureStorageOperationChain = next.then(() => undefined, () => undefined);
  return next;
}

function redactStoredApiKey(storageKey, id) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || (storageKey === STORAGE_APIS ? "[]" : "{}"));
    if (Array.isArray(parsed)) {
      let changed = false;
      parsed.forEach(item => {
        if (item?.id === id && item.apiKey) {
          item.apiKey = "";
          item.hasSecureKey = true;
          changed = true;
        }
      });
      if (changed) localStorage.setItem(storageKey, JSON.stringify(parsed));
    } else if (parsed?.id === id && parsed.apiKey) {
      parsed.apiKey = "";
      parsed.hasSecureKey = true;
      localStorage.setItem(storageKey, JSON.stringify(parsed));
    }
  } catch (err) {
    console.warn("API Key 本地记录脱敏失败", err);
  }
}

function persistApiKeySecurely(config, storageKey) {
  if (!secureStorageBridgeAvailable() || !config?.id || !config.apiKey || config.apiProvider === "opencodex") return;
  const id = config.id;
  const secretName = secureApiKeyName(id);
  const next = queueSecureStorageOperation(() => nativeDownload.saveSecret(secretName, config.apiKey))
    .then(() => redactStoredApiKey(storageKey, id))
    .catch(err => console.warn("系统安全存储写入失败，暂时保留本地配置以避免 Key 丢失", err));
  void next;
}

function saveConfig(config) {
  const normalized = normalizeApiConfig(config);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  persistApiKeySecurely(normalized, STORAGE_KEY);
}
function clearConfig() {
  let id = "";
  try { id = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}").id || ""; } catch {}
  localStorage.removeItem(STORAGE_KEY);
  if (id && secureStorageBridgeAvailable()) {
    void queueSecureStorageOperation(() => nativeDownload.deleteSecret(secureApiKeyName(id))).catch(() => {});
  }
}

function makeApiId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `api_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeApiConfig(config = {}) {
  const endpoint = String(config.endpoint || "").trim();
  const inferredProvider = inferApiProvider(endpoint);
  const configuredProvider = config.apiProvider || config.provider || inferredProvider;
  const apiProvider = configuredProvider === "custom" && inferredProvider === "opencodex"
    ? "opencodex"
    : configuredProvider;
  const openCodexImageOptions = apiProvider === "opencodex"
    ? normalizeOpenCodexImageOptions({
        ...(config.openCodexImageOptions || {}),
        model: OPENCODEX_MODELS.includes(config.model) ? config.model : config.openCodexImageOptions?.model,
      })
    : undefined;
  return {
    id: config.id || makeApiId(),
    name: config.name || readableEndpoint(endpoint) || cleanText("manualApi"),
    apiProvider,
    endpoint: apiProvider === "opencodex" ? OPENCODEX_API_ENDPOINT : endpoint,
    apiKey: apiProvider === "opencodex" ? OPENCODEX_PLACEHOLDER_KEY : (config.apiKey || ""),
    hasSecureKey: apiProvider === "opencodex" ? false : config.hasSecureKey === true,
    model: apiProvider === "opencodex" ? openCodexImageOptions.model : (config.model || ""),
    officialImageOptions: apiProvider === "official" ? normalizeOfficialImageOptions(config.officialImageOptions) : undefined,
    openCodexImageOptions,
    proxyEndpoint: config.proxyEndpoint || "",
    platform: config.platform || apiProviderLabel(apiProvider) || readableEndpoint(endpoint) || cleanText("customApi"),
  };
}

function loadDefaultApiId() {
  return localStorage.getItem(DEFAULT_API_KEY) || "";
}

function saveDefaultApiId(id) {
  if (id) localStorage.setItem(DEFAULT_API_KEY, id);
  else localStorage.removeItem(DEFAULT_API_KEY);
}

function getDefaultApiConfig() {
  const id = loadDefaultApiId();
  if (!id) return null;
  const apis = loadAllApis();
  const byId = apis.find(api => api.id === id);
  if (byId) return byId;
  if (/^\d+$/.test(id)) {
    const legacy = apis[Number(id)];
    if (legacy) {
      saveDefaultApiId(legacy.id);
      return legacy;
    }
  }
  return null;
}

function inferApiProvider(endpoint = "") {
  const ep = String(endpoint).toLowerCase();
  if (/^https?:\/\/(?:127\.0\.0\.1|localhost):10100(?:\/|$)/.test(ep)) return "opencodex";
  if (/grsai|dakka\.com\.cn|grsaiapi/.test(ep)) return "grsai";
  if (/api\.openai\.com/.test(ep)) return "official";
  return "custom";
}

function isPresetEndpoint(endpoint = "") {
  const clean = String(endpoint).trim().replace(/\/+$/, "");
  return Object.values(API_PROVIDER_PRESETS).some(p => p.endpoint && p.endpoint.replace(/\/+$/, "") === clean);
}

function apiProviderLabel(provider) {
  return cleanText(API_PROVIDER_PRESETS[provider]?.labelKey || "customApi");
}

function updateApiProviderHint(provider = dom.apiProvider?.value || "custom") {
  if (!$("#apiProviderHint")) return;
  const hints = {
    official: `${cleanText("officialApi")} · ${OFFICIAL_API_ENDPOINT}`,
    opencodex: `${cleanText("opencodexApi")} · ${OPENCODEX_API_ENDPOINT}`,
    grsai: cleanText("apiProviderHint"),
    custom: `${cleanText("customApi")} · ${cleanText("apiUrl")}`,
  };
  $("#apiProviderHint").textContent = hints[provider] || hints.custom;
}

function applyApiProvider(provider = "custom", options = {}) {
  const next = API_PROVIDER_PRESETS[provider] ? provider : "custom";
  if (dom.apiProvider) dom.apiProvider.value = next;
  const preset = API_PROVIDER_PRESETS[next];
  const shouldSetEndpoint = options.forceEndpoint || (!dom.apiEndpoint?.value.trim() && next !== "custom");
  if (shouldSetEndpoint && preset.endpoint) dom.apiEndpoint.value = preset.endpoint;
  if (next === "custom" && options.forceEndpoint && isPresetEndpoint(dom.apiEndpoint.value)) {
    dom.apiEndpoint.value = "";
  }
  if (dom.apiEndpoint) {
    dom.apiEndpoint.readOnly = next !== "custom";
    dom.apiEndpoint.placeholder = preset.endpoint || "https://your-api.example.com/v1/images/generations";
  }
  if (next === "opencodex") {
    if (options.forceEndpoint || !dom.apiKey?.value.trim()) dom.apiKey.value = OPENCODEX_PLACEHOLDER_KEY;
    const selectedModel = getOpenCodexImageOptions().model;
    if (options.forceEndpoint || !OPENCODEX_MODELS.includes(dom.model?.value.trim())) dom.model.value = selectedModel;
  }
  if (dom.apiKey) dom.apiKey.readOnly = next === "opencodex";
  if (dom.model) dom.model.readOnly = next === "opencodex";
  customSelects.apiProvider?.syncLabel();
  updateApiProviderHint(next);
  updateProviderPanelVisibility(next);
  updateApiQuickState();
  updateOfficialCostSummary();
  syncOpenCodexGenerateAvailability();
}

function applyConfig(cfg) {
  const applySequence = ++apiConfigApplySequence;
  const endpoint = cfg.endpoint || API_PROVIDER_PRESETS[cfg.apiProvider || "grsai"]?.endpoint || "";
  const provider = cfg.apiProvider || cfg.provider || inferApiProvider(endpoint);
  applyApiProvider(provider, { forceEndpoint: false });
  dom.apiEndpoint.value = endpoint;
  dom.apiKey.value = cfg.apiKey || "";
  if (!cfg.apiKey && cfg.hasSecureKey && cfg.id) {
    const expectedId = cfg.id;
    setTimeout(() => {
      if (!secureStorageBridgeAvailable()) return;
      void queueSecureStorageOperation(() => nativeDownload.loadSecret(secureApiKeyName(expectedId))).then(value => {
        const active = loadConfig();
        if (applySequence !== apiConfigApplySequence || active.id !== expectedId || !value || dom.apiKey.value.trim()) return;
        dom.apiKey.value = String(value);
        updateApiQuickState();
      }).catch(err => console.warn("系统安全存储读取 API Key 失败", err));
    }, 0);
  }
  dom.model.value = cfg.model || "";
  applyOfficialImageOptions(cfg.officialImageOptions || OFFICIAL_IMAGE_OPTION_DEFAULTS);
  applyOpenCodexImageOptions(cfg.openCodexImageOptions || OPENCODEX_IMAGE_OPTION_DEFAULTS);
  dom.proxyEndpoint.value = cfg.proxyEndpoint || "";
  if (!cfg.model && provider === "grsai") dom.model.placeholder = "点击输入或检测选择模型";
  if (!cfg.model && provider === "official") dom.model.value = "gpt-image-2";
  if (provider === "opencodex") {
    dom.apiKey.value = OPENCODEX_PLACEHOLDER_KEY;
    dom.model.value = getOpenCodexImageOptions().model;
    setModelChoices(OPENCODEX_MODELS);
    setOpenCodexHealthState("idle");
    setTimeout(() => void checkOpenCodexHealth({ announce: false, force: true }), 0);
  }
  updateOfficialOptionAvailability();
  updateApiQuickState();
}

function apiConfigIdentityMatches(config, provider, endpoint) {
  if (!config) return false;
  const normalizeEndpoint = value => String(value || "").trim().replace(/\/+$/, "").toLowerCase();
  const configProvider = config.apiProvider || config.provider || inferApiProvider(config.endpoint || "");
  return configProvider === provider && normalizeEndpoint(config.endpoint) === normalizeEndpoint(endpoint);
}

function getSelectedSavedApiConfig(apis = loadAllApis()) {
  const index = findSavedApiIndex(dom.savedApis?.value, apis);
  return index >= 0 ? apis[index] : null;
}

function currentApiConfig(name = "", options = {}) {
  const endpoint = dom.apiEndpoint.value.trim();
  const active = loadConfig();
  const provider = dom.apiProvider?.value || inferApiProvider(endpoint);
  const selected = getSelectedSavedApiConfig();
  const identitySource = !options.forceNew && apiConfigIdentityMatches(selected, provider, endpoint)
    ? selected
    : !options.forceNew && apiConfigIdentityMatches(active, provider, endpoint)
      ? active
      : null;
  const apiKey = dom.apiKey.value.trim();
  return {
    id: identitySource?.id || makeApiId(),
    name: name || identitySource?.name || readableEndpoint(endpoint) || apiProviderLabel(provider) || "未命名",
    apiProvider: provider,
    endpoint,
    apiKey,
    hasSecureKey: !apiKey && identitySource?.hasSecureKey === true,
    model: dom.model.value.trim(),
    officialImageOptions: provider === "official" ? getOfficialImageOptions() : undefined,
    openCodexImageOptions: provider === "opencodex" ? getOpenCodexImageOptions() : undefined,
    proxyEndpoint: dom.proxyEndpoint.value.trim(),
    platform: (findAdapter(endpoint, provider) || {}).name || "未知",
  };
}

function maskApiKey(key) {
  if (!key) return "";
  if (key.length <= 10) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function readableEndpoint(endpoint) {
  if (!endpoint) return "";
  try {
    const normalized = /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
    return new URL(normalized).host || endpoint;
  } catch {
    return endpoint.replace(/^https?:\/\//i, "").split("/")[0] || endpoint;
  }
}

function updateApiQuickState() {
  if (!dom.apiQuickCard) return;
  const endpoint = dom.apiEndpoint?.value.trim() || "";
  const apiKey = dom.apiKey?.value.trim() || "";
  const model = dom.model?.value.trim() || "gpt-image-2";
  const connected = Boolean(endpoint && apiKey);
  dom.apiQuickCard.classList.toggle("is-connected", connected);
  if (dom.apiQuickTitle) {
    dom.apiQuickTitle.textContent = cleanText(connected ? "apiConnected" : "apiDisconnected");
  }
  if (dom.apiQuickMeta) {
    if (connected) {
      let adapter = null;
      const provider = dom.apiProvider?.value || inferApiProvider(endpoint);
      try {
        adapter = findAdapter(endpoint, provider);
      } catch {
        adapter = null;
      }
      const platform = apiProviderLabel(provider) || adapter?.name || readableEndpoint(endpoint);
      dom.apiQuickMeta.textContent = `${platform} · ${model} · ${maskApiKey(apiKey)}`;
    } else {
      const provider = apiProviderLabel(dom.apiProvider?.value || inferApiProvider(endpoint));
      dom.apiQuickMeta.textContent = `${provider} · ${cleanText("apiConnectHint")}`;
    }
  }
}

const STORAGE_APIS = "ai_image_gen_apis";
let apiProfileRepairNotice = null;

function repairDuplicateApiConfigIds(configs = [], activeConfig = {}) {
  const repaired = configs.map(config => ({ ...config }));
  const groups = new Map();
  repaired.forEach((config, index) => {
    const secretSlot = secureApiKeyName(config.id);
    if (!groups.has(secretSlot)) groups.set(secretSlot, []);
    groups.get(secretSlot).push(index);
  });
  const resetProfiles = [];
  const activeSecretSlot = activeConfig.id ? secureApiKeyName(activeConfig.id) : "";
  for (const [secretSlot, indexes] of groups) {
    if (!secretSlot || indexes.length < 2) continue;
    const activeProvider = activeConfig.apiProvider || activeConfig.provider || inferApiProvider(activeConfig.endpoint || "");
    const keeper = indexes.find(index => {
      const config = repaired[index];
      return activeSecretSlot === secretSlot
        && apiConfigIdentityMatches(config, activeProvider, activeConfig.endpoint || "")
        && (!activeConfig.name || config.name === activeConfig.name);
    }) ?? indexes.find(index => activeSecretSlot === secretSlot
      && apiConfigIdentityMatches(repaired[index], activeProvider, activeConfig.endpoint || "")) ?? indexes[0];
    indexes.forEach(index => {
      if (index === keeper) return;
      const config = repaired[index];
      config.id = makeApiId();
      if (!config.apiKey && config.hasSecureKey) {
        config.hasSecureKey = false;
        resetProfiles.push(config.name || readableEndpoint(config.endpoint) || apiProviderLabel(config.apiProvider));
      }
    });
  }
  return {
    configs: repaired,
    changed: resetProfiles.length > 0 || repaired.some((config, index) => config.id !== configs[index]?.id),
    resetProfiles,
  };
}

function apiProfileRepairMessage(names = []) {
  const count = names.length;
  const messages = {
    "zh-CN": `检测到旧版 API 配置共用了密钥槽，已安全拆分；请为 ${count} 个冲突配置重新填写 API Key。`,
    "zh-Hant": `偵測到舊版 API 設定共用了金鑰槽，已安全拆分；請為 ${count} 個衝突設定重新填寫 API Key。`,
    en: `Legacy API profiles shared one secret slot and were separated. Re-enter the API key for ${count} conflicting profile(s).`,
    ja: `旧版 API 設定が同じ秘密鍵スロットを共有していたため分離しました。競合した ${count} 件の API Key を再入力してください。`,
    ko: `이전 API 설정이 하나의 비밀 키 슬롯을 공유해 분리했습니다. 충돌한 ${count}개 설정의 API Key를 다시 입력하세요.`,
  };
  return messages[currentLanguage] || messages["zh-CN"];
}

function loadAllApis() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_APIS) || "[]");
    if (!Array.isArray(raw)) return [];
    let migrated = false;
    const normalized = raw.map(item => {
      if (!item?.id) migrated = true;
      if ((item?.apiProvider || item?.provider) === "custom" && inferApiProvider(item?.endpoint || "") === "opencodex") migrated = true;
      return normalizeApiConfig(item);
    });
    let activeConfig = {};
    try { activeConfig = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch {}
    const repair = repairDuplicateApiConfigIds(normalized, activeConfig);
    if (repair.changed) {
      migrated = true;
      apiProfileRepairNotice = repair.resetProfiles;
    }
    if (migrated) localStorage.setItem(STORAGE_APIS, JSON.stringify(repair.configs));
    return repair.configs;
  }
  catch { return []; }
}
function saveAllApis(list) {
  const normalized = (list || []).map(normalizeApiConfig);
  let activeConfig = {};
  try { activeConfig = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch {}
  const repaired = repairDuplicateApiConfigIds(normalized, activeConfig).configs;
  localStorage.setItem(STORAGE_APIS, JSON.stringify(repaired));
  repaired.forEach(config => persistApiKeySecurely(config, STORAGE_APIS));
}

function renderSavedApis() {
  const apis = loadAllApis();
  const defaultId = loadDefaultApiId();
  dom.savedApis.innerHTML = `<option value="">${cleanText("manualApi")}</option>`;
  apis.forEach((api, index) => {
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.dataset.apiId = api.id;
    const provider = api.apiProvider || api.provider || inferApiProvider(api.endpoint || "");
    opt.textContent = `${api.id === defaultId ? "★ " : ""}${apiProviderLabel(provider)} · ${api.name || api.endpoint}`;
    dom.savedApis.appendChild(opt);
  });
  customSelects.savedApis?.syncLabel();
}

function findSavedApiIndex(value, apis = loadAllApis()) {
  if (!value && value !== 0) return -1;
  const asString = String(value);
  const byId = apis.findIndex(api => api.id === asString);
  if (byId >= 0) return byId;
  if (/^\d+$/.test(asString)) {
    const byLegacyIndex = Number(asString);
    if (byLegacyIndex >= 0 && byLegacyIndex < apis.length) return byLegacyIndex;
  }
  return -1;
}

function keepApiConfigVisible() {
  if (!dom.configSection) return;
  dom.configSection.open = true;
  const panel = dom.configSection.closest(".input-panel");
  if (panel) panel.scrollTop = Math.max(0, dom.configSection.offsetTop - 8);
  dom.configSection.querySelector(".config-body")?.scrollTo?.({ top: 0 });
  dom.configSection.scrollIntoView?.({ block: "start", inline: "nearest" });
}

dom.savedApis.addEventListener("change", () => {
  const selectedId = dom.savedApis.value;
  if (selectedId === "") {
    detachSavedApiProfile();
    saveConfig(currentApiConfig(apiProviderLabel(dom.apiProvider?.value || "custom"), { forceNew: true }));
    updateApiQuickState();
    return;
  }
  const apis = loadAllApis();
  const api = apis[findSavedApiIndex(selectedId, apis)];
  if (api) {
    applyConfig(api);
    saveConfig(api);
    showStatus(`已切换: ${api.name || api.endpoint}`, "info");
    updateApiQuickState();
  }
});

dom.saveConfig.addEventListener("click", async () => {
  const name = await askPrompt("给这个配置起个名字（如：huanapi / GrsAI）：", "");
  if (name === null) return;
  const apis = loadAllApis();
  const selectedId = dom.savedApis.value;
  const selectedIdx = findSavedApiIndex(selectedId, apis);
  const cfg = currentApiConfig(name || "未命名", { forceNew: selectedIdx < 0 });
  const selectedMatches = selectedIdx >= 0 && apiConfigIdentityMatches(apis[selectedIdx], cfg.apiProvider, cfg.endpoint);
  const existIdx = selectedMatches ? selectedIdx : -1;
  if (existIdx >= 0) {
    cfg.id = apis[existIdx].id;
    apis[existIdx] = cfg;
  }
  else apis.push(cfg);
  saveAllApis(apis);
  saveConfig(cfg);
  renderSavedApis();
  dom.savedApis.value = String(findSavedApiIndex(cfg.id, loadAllApis()));
  customSelects.savedApis?.syncLabel();
  showStatus(`已保存: ${cfg.name} ✅`, "success");
  keepApiConfigVisible();
  updateApiQuickState();
});

dom.setDefaultApi?.addEventListener("click", () => {
  let apis = loadAllApis();
  let cfg = apis[findSavedApiIndex(dom.savedApis.value, apis)];
  if (!cfg) {
    cfg = currentApiConfig(readableEndpoint(dom.apiEndpoint.value.trim()) || apiProviderLabel(dom.apiProvider?.value || "custom"));
    const active = loadConfig();
    if (active.id && active.endpoint !== cfg.endpoint) cfg.id = makeApiId();
    if (!cfg.endpoint) {
      showStatus("请先填写 API 地址，再设为默认", "error");
      return;
    }
    const existingIdx = apis.findIndex(api => api.endpoint === cfg.endpoint && api.apiKey === cfg.apiKey);
    if (existingIdx >= 0) {
      cfg.id = apis[existingIdx].id;
      apis[existingIdx] = cfg;
    } else {
      apis.push(cfg);
    }
    saveAllApis(apis);
  }
  saveDefaultApiId(cfg.id);
  saveConfig(cfg);
  applyConfig(cfg);
  renderSavedApis();
  dom.savedApis.value = String(findSavedApiIndex(cfg.id, loadAllApis()));
  customSelects.savedApis?.syncLabel();
  showStatus(`已设为默认 API: ${cfg.name}`, "success");
  keepApiConfigVisible();
});

dom.deleteSavedApi.addEventListener("click", async () => {
  const selectedId = dom.savedApis.value;
  if (!selectedId) return;
  const apis = loadAllApis();
  const idx = findSavedApiIndex(selectedId, apis);
  if (idx < 0) return;
  const deleted = apis[idx];
  const name = deleted?.name;
  if (!(await askConfirm(`删除配置「${name}」?`))) return;
  apis.splice(idx, 1);
  saveAllApis(apis);
  if (deleted?.id && secureStorageBridgeAvailable()) {
    void queueSecureStorageOperation(() => nativeDownload.deleteSecret(secureApiKeyName(deleted.id))).catch(() => {});
  }
  if (loadDefaultApiId() === deleted?.id) saveDefaultApiId("");
  dom.savedApis.value = "";
  renderSavedApis();
  const active = loadConfig();
  const deletingActive = deleted && ((active.id && deleted.id)
    ? active.id === deleted.id
    : (
      active.name === deleted.name ||
      (active.endpoint && active.endpoint === deleted.endpoint && active.apiKey === deleted.apiKey)
    ));
  if (deletingActive) {
    clearConfig();
    applyApiProvider("custom", { forceEndpoint: true });
    dom.apiEndpoint.value = "";
    dom.apiKey.value = "";
    dom.model.value = "";
    dom.proxyEndpoint.value = "";
  }
  showStatus(`已删除: ${name}`, "info");
  updateApiQuickState();
});

function detachSavedApiProfile({ clearKey = true } = {}) {
  apiConfigApplySequence++;
  if (dom.savedApis) dom.savedApis.value = "";
  customSelects.savedApis?.syncLabel();
  if (clearKey && dom.apiKey) dom.apiKey.value = "";
  if (dom.proxyEndpoint) dom.proxyEndpoint.value = "";
  applyOfficialImageOptions(OFFICIAL_IMAGE_OPTION_DEFAULTS);
  applyOpenCodexImageOptions(OPENCODEX_IMAGE_OPTION_DEFAULTS);
}

dom.apiProvider?.addEventListener("change", () => {
  const provider = dom.apiProvider.value;
  detachSavedApiProfile();
  applyApiProvider(provider, { forceEndpoint: true });
  if (provider === "grsai") {
    loadGrsaiModels();
    dom.model.placeholder = "点击输入或检测选择模型";
  } else if (provider === "official") {
    loadOfficialModels();
  } else if (provider === "opencodex") {
    setModelChoices(OPENCODEX_MODELS);
    dom.model.value = getOpenCodexImageOptions().model;
    updateOpenCodexOptionAvailability();
    setOpenCodexHealthState("idle");
    void checkOpenCodexHealth({ announce: true, force: true });
  } else if (GRSAI_NANO_BANANA_MODELS.includes(dom.model.value.trim()) || dom.model.value.trim() === "gpt-image-2-vip") {
    dom.model.value = "";
  }
  saveConfig(currentApiConfig(apiProviderLabel(provider), { forceNew: true }));
  updateApiQuickState();
  scheduleOfficialCostSummaryUpdate();
  if (provider === "official") void refreshUsdCnyRate({ force: false, announce: false });
});

function persistCurrentProviderOptions() {
  const cfg = currentApiConfig();
  saveConfig(cfg);
  const selectedId = dom.savedApis.value;
  if (!selectedId) return;
  const apis = loadAllApis();
  const index = findSavedApiIndex(selectedId, apis);
  if (index < 0 || !apiConfigIdentityMatches(apis[index], cfg.apiProvider, cfg.endpoint)) return;
  cfg.id = apis[index].id;
  cfg.name = apis[index].name;
  apis[index] = cfg;
  saveAllApis(apis);
  renderSavedApis();
  dom.savedApis.value = String(findSavedApiIndex(cfg.id, loadAllApis()));
  customSelects.savedApis?.syncLabel();
}

document.querySelectorAll(".provider-segments[data-provider-control]").forEach(group => {
  group.addEventListener("click", event => {
    const button = event.target.closest("button[data-value]");
    if (!button || button.disabled) return;
    const controlId = group.dataset.providerControl;
    setProviderSegmentValue(controlId, button.dataset.value);
    updateOfficialOptionAvailability();
    updateOpenCodexOptionAvailability();
    persistCurrentProviderOptions();
    scheduleOfficialCostSummaryUpdate();
  });
});

dom.officialOutputCompression?.addEventListener("input", () => {
  if (dom.officialCompressionValue) dom.officialCompressionValue.textContent = dom.officialOutputCompression.value;
});
dom.officialOutputCompression?.addEventListener("change", persistCurrentProviderOptions);
dom.openCodexAspectRatio?.addEventListener("change", () => {
  updateOpenCodexOptionAvailability();
  persistCurrentProviderOptions();
});
dom.testOpenCodexHealth?.addEventListener("click", () => {
  void checkOpenCodexHealth({ announce: true, force: true });
});
dom.refreshOfficialRate?.addEventListener("click", () => {
  void refreshUsdCnyRate({ force: true, announce: true });
});
dom.officialPricingLink?.addEventListener("click", () => {
  void openExternalUrl(OPENAI_PRICING_URL);
});

// ─── gpt-image-2 局部重绘 ──────────────────────────────────
// 官方 OpenAI 接收原生 mask；OpenCodex 接收“图片 + 文字”的语义编辑请求。
// 两条路径最终都在本地按蒙版合成，保证蒙版外像素不参与混合。
const INPAINT_PAINT_STATUS = Object.freeze({
  "zh-CN": "原图已载入，请涂抹要修改的区域。",
  "zh-Hant": "原圖已載入，請塗抹要修改的區域。",
  en: "Source loaded. Paint the area to change.",
  ja: "元画像を読み込みました。変更する領域を塗ってください。",
  ko: "원본을 불러왔습니다. 변경할 영역을 칠하세요.",
});

function setInpaintStatus(message, type = "info") {
  if (!dom.inpaintStatus) return;
  dom.inpaintStatus.className = `status ${type} inpaint-status`;
  dom.inpaintStatus.textContent = String(message || "");
}

function loadImageElement(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败"));
    image.src = source;
  });
}

function updateInpaintHistoryButtons() {
  if (dom.inpaintUndo) dom.inpaintUndo.disabled = inpaintState.actions.length === 0;
  if (dom.inpaintRedo) dom.inpaintRedo.disabled = inpaintState.redoActions.length === 0;
}

function setInpaintTool(tool) {
  inpaintState.tool = tool === "eraser" ? "eraser" : "brush";
  const brushActive = inpaintState.tool === "brush";
  dom.inpaintBrush?.classList.toggle("active", brushActive);
  dom.inpaintEraser?.classList.toggle("active", !brushActive);
  dom.inpaintBrush?.setAttribute("aria-pressed", String(brushActive));
  dom.inpaintEraser?.setAttribute("aria-pressed", String(!brushActive));
}

function updateInpaintStageSize() {
  const source = inpaintState.source;
  if (!source || !dom.inpaintCanvasStage || !dom.inpaintCanvasScroller) return;
  const availableWidth = Math.max(160, dom.inpaintCanvasScroller.clientWidth - 30);
  const availableHeight = Math.max(160, dom.inpaintCanvasScroller.clientHeight - 30);
  const scale = inpaintState.zoomMode === "100"
    ? 1
    : Math.min(1, availableWidth / source.width, availableHeight / source.height);
  dom.inpaintCanvasStage.style.width = `${Math.max(1, Math.round(source.width * scale))}px`;
  dom.inpaintCanvasStage.style.height = `${Math.max(1, Math.round(source.height * scale))}px`;
  dom.inpaintCanvasStage.classList.toggle("is-fit", inpaintState.zoomMode === "fit");
  dom.inpaintZoomFit?.classList.toggle("active", inpaintState.zoomMode === "fit");
  dom.inpaintZoom100?.classList.toggle("active", inpaintState.zoomMode === "100");
}

function drawMaskStroke(context, stroke, color) {
  if (!context || !stroke?.points?.length) return;
  context.save();
  context.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = stroke.size;
  context.lineCap = "round";
  context.lineJoin = "round";
  const first = stroke.points[0];
  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (let i = 1; i < stroke.points.length; i++) {
      context.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    context.stroke();
  }
  context.restore();
}

function replayInpaintMask() {
  const dataCanvas = inpaintState.maskDataCanvas;
  const displayCanvas = dom.inpaintMaskCanvas;
  if (!dataCanvas || !displayCanvas) return;
  const dataContext = dataCanvas.getContext("2d");
  const displayContext = displayCanvas.getContext("2d");
  dataContext.clearRect(0, 0, dataCanvas.width, dataCanvas.height);
  displayContext.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
  inpaintState.actions.forEach(stroke => {
    drawMaskStroke(dataContext, stroke, "#fff");
    drawMaskStroke(displayContext, stroke, "rgba(255, 70, 105, 0.58)");
  });
  updateInpaintHistoryButtons();
}

function resetInpaintCandidates() {
  inpaintState.candidates = [];
  inpaintState.selectedCandidate = -1;
  inpaintState.cropPlan = null;
  inpaintState.providerMode = "";
  inpaintState.resultDataUrl = "";
  if (dom.inpaintCandidateStrip) dom.inpaintCandidateStrip.innerHTML = "";
  dom.inpaintAlignment?.classList.add("hidden");
  dom.applyInpaint?.classList.add("hidden");
  ["inpaintOffsetX", "inpaintOffsetY"].forEach(key => {
    if (dom[key]) dom[key].value = "0";
  });
  if (dom.inpaintScale) dom.inpaintScale.value = "100";
  updateInpaintAlignmentLabels();
}

async function loadInpaintSourceBlob(blob, name = "image") {
  const normalized = await normalizeImageBlob(blob);
  const dataUrl = await blobToDataUrl(normalized);
  const image = await loadImageElement(dataUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) throw new Error("无法读取图片尺寸");
  [dom.inpaintBaseCanvas, dom.inpaintPreviewCanvas, dom.inpaintMaskCanvas, inpaintState.maskDataCanvas].forEach(canvas => {
    canvas.width = width;
    canvas.height = height;
  });
  dom.inpaintBaseCanvas.getContext("2d").drawImage(image, 0, 0, width, height);
  dom.inpaintPreviewCanvas.getContext("2d").drawImage(image, 0, 0, width, height);
  inpaintState.source = {
    image,
    dataUrl,
    width,
    height,
    mimeType: normalized.type || "image/png",
    bytes: normalized.size,
  };
  inpaintState.sourceName = name;
  inpaintState.sourceMime = normalized.type || "image/png";
  inpaintState.actions = [];
  inpaintState.redoActions = [];
  inpaintState.activeStroke = null;
  resetInpaintCandidates();
  replayInpaintMask();
  dom.inpaintEmpty?.classList.add("hidden");
  if (dom.inpaintSourceMeta) {
    dom.inpaintSourceMeta.textContent = `${name} · ${width}×${height} · ${formatImageBytes(normalized.size)}`;
  }
  requestAnimationFrame(updateInpaintStageSize);
  setInpaintStatus(INPAINT_PAINT_STATUS[currentLanguage] || INPAINT_PAINT_STATUS["zh-CN"], "info");
}

async function openInpaintFromCard(card) {
  if (!card) return;
  if (!getInpaintProviderMode()) {
    showStatus(cleanText("inpaintRequiresGptImage2"), "error");
    return;
  }
  openModal(dom.inpaintModal);
  setInpaintStatus("正在读取本地图片缓存…", "info");
  try {
    let blob = await Promise.resolve(card._imageCachePromise).catch(() => null);
    if (!(blob instanceof Blob)) {
      const source = card._zipBlob || card._localImageUrl || card._zipImage?.url;
      if (!source) throw new Error("该结果没有可用的图片缓存");
      blob = await imageUrlToBlobWithFallback(source, card._zipImage?.originalUrl || "");
    }
    await loadInpaintSourceBlob(blob, `分镜 ${card.dataset.panelId || ""}`.trim());
  } catch (error) {
    setInpaintStatus(`读取原图失败：${error.message || error}`, "error");
  }
}

function canvasPointFromPointer(event) {
  const canvas = dom.inpaintMaskCanvas;
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / Math.max(1, rect.width))),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / Math.max(1, rect.height))),
  };
}

function analyzeInpaintMask(canvas = inpaintState.maskDataCanvas) {
  if (!canvas?.width || !canvas?.height) return null;
  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count++;
    }
  }
  if (!count) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    pixels: count,
    coverage: count / (canvas.width * canvas.height),
  };
}

const INPAINT_PATCH_ASPECT_RATIOS = Object.freeze(["1:1", "3:2", "2:3"]);

function nearestInpaintAspectRatio(width, height) {
  const target = width / Math.max(1, height);
  let best = INPAINT_PATCH_ASPECT_RATIOS[0];
  let bestDistance = Infinity;
  INPAINT_PATCH_ASPECT_RATIOS.forEach(value => {
    const [w, h] = value.split(":").map(Number);
    const distance = Math.abs(Math.log(target / (w / h)));
    if (distance < bestDistance) {
      best = value;
      bestDistance = distance;
    }
  });
  return best;
}

function planInpaintCrop(mask, imageWidth, imageHeight, contextPercent = 15) {
  const padding = Math.max(64, Math.round(Math.max(mask.width, mask.height) * contextPercent / 100));
  let left = Math.max(0, mask.minX - padding);
  let top = Math.max(0, mask.minY - padding);
  let right = Math.min(imageWidth, mask.maxX + 1 + padding);
  let bottom = Math.min(imageHeight, mask.maxY + 1 + padding);
  const aspectRatio = nearestInpaintAspectRatio(right - left, bottom - top);
  const [ratioWidth, ratioHeight] = aspectRatio.split(":").map(Number);
  const targetRatio = ratioWidth / ratioHeight;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  let width = right - left;
  let height = bottom - top;
  if (width / height < targetRatio) width = Math.min(imageWidth, Math.ceil(height * targetRatio));
  else height = Math.min(imageHeight, Math.ceil(width / targetRatio));
  left = Math.max(0, Math.min(imageWidth - width, Math.round(centerX - width / 2)));
  top = Math.max(0, Math.min(imageHeight - height, Math.round(centerY - height / 2)));
  width = Math.min(imageWidth - left, Math.round(width));
  height = Math.min(imageHeight - top, Math.round(height));
  return { x: left, y: top, width, height, aspectRatio };
}

function buildOfficialInpaintMaskDataUrl(canvas = inpaintState.maskDataCanvas) {
  if (!canvas?.width || !canvas?.height) throw new Error("蒙版尺寸无效");
  const source = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = canvas.width;
  outputCanvas.height = canvas.height;
  const outputContext = outputCanvas.getContext("2d");
  const output = outputContext.createImageData(canvas.width, canvas.height);
  for (let index = 0; index < canvas.width * canvas.height; index++) {
    const offset = index * 4;
    output.data[offset] = 255;
    output.data[offset + 1] = 255;
    output.data[offset + 2] = 255;
    // OpenAI 的透明区域是编辑区域；软件内涂抹区域则是非透明，因此需要反转 alpha。
    output.data[offset + 3] = 255 - source.data[offset + 3];
  }
  outputContext.putImageData(output, 0, 0);
  return outputCanvas.toDataURL("image/png");
}

function getOfficialInpaintRequestSize(source) {
  const exact = `${source.width}x${source.height}`;
  try {
    validateOfficialImageSize("gpt-image-2", exact);
    return exact;
  } catch {
    return "auto";
  }
}

function getOpenCodexInpaintRequestSize(crop) {
  const ratio = crop.width / Math.max(1, crop.height);
  if (ratio >= 1.2) return "1536x1024";
  if (ratio <= (1 / 1.2)) return "1024x1536";
  return "1024x1024";
}

function buildInwardFeatherAlpha(maskImageData, width, height, featherRadius) {
  const length = width * height;
  const inside = new Uint8Array(length);
  const alpha = new Uint8ClampedArray(length);
  const distance = new Float32Array(length);
  const infinite = width + height + 1;
  for (let i = 0; i < length; i++) {
    const raw = maskImageData.data[i * 4 + 3];
    inside[i] = raw > 0 ? 1 : 0;
    distance[i] = raw > 0 ? infinite : 0;
  }
  if (featherRadius <= 0) {
    for (let i = 0; i < length; i++) alpha[i] = maskImageData.data[i * 4 + 3];
    return alpha;
  }
  const diagonal = Math.SQRT2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!inside[i]) continue;
      let value = distance[i];
      if (x > 0) value = Math.min(value, distance[i - 1] + 1);
      if (y > 0) value = Math.min(value, distance[i - width] + 1);
      if (x > 0 && y > 0) value = Math.min(value, distance[i - width - 1] + diagonal);
      if (x + 1 < width && y > 0) value = Math.min(value, distance[i - width + 1] + diagonal);
      distance[i] = value;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!inside[i]) continue;
      let value = distance[i];
      if (x + 1 < width) value = Math.min(value, distance[i + 1] + 1);
      if (y + 1 < height) value = Math.min(value, distance[i + width] + 1);
      if (x + 1 < width && y + 1 < height) value = Math.min(value, distance[i + width + 1] + diagonal);
      if (x > 0 && y + 1 < height) value = Math.min(value, distance[i + width - 1] + diagonal);
      distance[i] = value;
      const raw = maskImageData.data[i * 4 + 3] / 255;
      alpha[i] = Math.round(255 * raw * Math.min(1, value / featherRadius));
    }
  }
  return alpha;
}

function compositeInpaintPixels(original, patch, maskAlpha, crop) {
  const output = new ImageData(new Uint8ClampedArray(original.data), original.width, original.height);
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const targetX = crop.x + x;
      const targetY = crop.y + y;
      const targetIndex = targetY * original.width + targetX;
      const amount = maskAlpha[targetIndex] / 255;
      if (amount <= 0) continue;
      const sourceIndex = (y * crop.width + x) * 4;
      const outputIndex = targetIndex * 4;
      for (let channel = 0; channel < 4; channel++) {
        output.data[outputIndex + channel] = Math.round(
          original.data[outputIndex + channel] * (1 - amount) + patch.data[sourceIndex + channel] * amount
        );
      }
    }
  }
  return output;
}

function updateInpaintAlignmentLabels() {
  if (dom.inpaintOffsetXValue) dom.inpaintOffsetXValue.textContent = dom.inpaintOffsetX?.value || "0";
  if (dom.inpaintOffsetYValue) dom.inpaintOffsetYValue.textContent = dom.inpaintOffsetY?.value || "0";
  if (dom.inpaintScaleValue) dom.inpaintScaleValue.textContent = dom.inpaintScale?.value || "100";
}

function renderInpaintPreview() {
  const source = inpaintState.source;
  const candidate = inpaintState.candidates[inpaintState.selectedCandidate];
  const crop = inpaintState.cropPlan;
  if (!source || !candidate?.image || !crop) return;
  const patchCanvas = document.createElement("canvas");
  patchCanvas.width = crop.width;
  patchCanvas.height = crop.height;
  const patchContext = patchCanvas.getContext("2d");
  const scaleAdjust = Number(dom.inpaintScale?.value || 100) / 100;
  const baseScale = Math.max(crop.width / candidate.image.naturalWidth, crop.height / candidate.image.naturalHeight) * scaleAdjust;
  const drawWidth = candidate.image.naturalWidth * baseScale;
  const drawHeight = candidate.image.naturalHeight * baseScale;
  const drawX = (crop.width - drawWidth) / 2 + Number(dom.inpaintOffsetX?.value || 0);
  const drawY = (crop.height - drawHeight) / 2 + Number(dom.inpaintOffsetY?.value || 0);
  patchContext.drawImage(candidate.image, drawX, drawY, drawWidth, drawHeight);
  const originalContext = dom.inpaintBaseCanvas.getContext("2d");
  const original = originalContext.getImageData(0, 0, source.width, source.height);
  const patch = patchContext.getImageData(0, 0, crop.width, crop.height);
  const mask = inpaintState.maskDataCanvas.getContext("2d").getImageData(0, 0, source.width, source.height);
  const alpha = buildInwardFeatherAlpha(mask, source.width, source.height, Number(dom.inpaintFeather?.value || 0));
  const result = compositeInpaintPixels(original, patch, alpha, crop);
  dom.inpaintPreviewCanvas.getContext("2d").putImageData(result, 0, 0);
  inpaintState.resultDataUrl = dom.inpaintPreviewCanvas.toDataURL("image/png");
}

function renderInpaintCandidates() {
  if (!dom.inpaintCandidateStrip) return;
  dom.inpaintCandidateStrip.innerHTML = "";
  inpaintState.candidates.forEach((candidate, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `inpaint-candidate${index === inpaintState.selectedCandidate ? " active" : ""}`;
    button.innerHTML = `<img src="${candidate.dataUrl}" alt="候选 ${index + 1}"><span>${index + 1}</span>`;
    button.addEventListener("click", () => {
      inpaintState.selectedCandidate = index;
      renderInpaintCandidates();
      renderInpaintPreview();
    });
    dom.inpaintCandidateStrip.appendChild(button);
  });
}

function responseImageToDataUrl(data) {
  const item = data?.data?.[0];
  if (!item) throw new Error("候选响应没有图片");
  if (item.b64_json) return `data:${item.mime_type || inferImageMimeFromBase64(item.b64_json)};base64,${item.b64_json}`;
  if (item.url) return item.url;
  throw new Error("候选响应没有可用图片字段");
}

async function generateInpaintCandidates() {
  const source = inpaintState.source;
  const prompt = String(dom.inpaintPrompt?.value || "").trim();
  if (!source) return setInpaintStatus(cleanText("inpaintNeedSource"), "error");
  if (!prompt) return setInpaintStatus(cleanText("inpaintNeedPrompt"), "error");
  const providerMode = getInpaintProviderMode();
  if (!providerMode) return setInpaintStatus(cleanText("inpaintRequiresGptImage2"), "error");
  const mask = analyzeInpaintMask();
  if (!mask) return setInpaintStatus(cleanText("inpaintNeedMask"), "error");
  if (mask.coverage > 0.95) {
    return setInpaintStatus("蒙版覆盖超过 95%，请直接使用参考图编辑，或缩小蒙版区域。", "error");
  }

  let crop;
  let requestSize;
  let requestPrompt;
  let requestOptions;
  if (providerMode === "official-native-mask") {
    crop = {
      x: 0,
      y: 0,
      width: source.width,
      height: source.height,
      aspectRatio: `${source.width}:${source.height}`,
    };
    const sourceDataUrl = dom.inpaintBaseCanvas.toDataURL("image/png");
    requestSize = getOfficialInpaintRequestSize(source);
    requestPrompt = [
      "Edit only the area identified by the supplied mask according to the instruction below.",
      "Preserve the composition, lighting, perspective, texture, and every unmasked detail.",
      `Instruction: ${prompt}`,
    ].join("\n");
    requestOptions = {
      references: [{ dataUrl: sourceDataUrl, width: source.width, height: source.height, fileName: "source.png" }],
      officialMask: {
        dataUrl: buildOfficialInpaintMaskDataUrl(),
        width: source.width,
        height: source.height,
        fileName: "mask.png",
      },
    };
  } else {
    crop = planInpaintCrop(mask, source.width, source.height, Number(dom.inpaintContext?.value || 15));
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = crop.width;
    cropCanvas.height = crop.height;
    cropCanvas.getContext("2d").drawImage(
      dom.inpaintBaseCanvas,
      crop.x, crop.y, crop.width, crop.height,
      0, 0, crop.width, crop.height
    );
    requestSize = getOpenCodexInpaintRequestSize(crop);
    requestPrompt = [
      "Edit the supplied image crop according to the instruction below.",
      "Preserve the surrounding composition, lighting, perspective, texture, and unchanged objects.",
      "Return one complete edited crop with no frame, labels, mask visualization, or explanation.",
      `Instruction: ${prompt}`,
    ].join("\n");
    requestOptions = {
      references: [{ dataUrl: cropCanvas.toDataURL("image/png"), width: crop.width, height: crop.height, fileName: "crop.png" }],
      openCodexOptions: {
        ...getOpenCodexImageOptions(),
        model: OPENCODEX_GPT_IMAGE_2,
      },
    };
  }

  const candidateCount = Math.max(1, Math.min(4, Number(dom.inpaintCandidateCount?.value || 2)));
  const controller = new AbortController();
  inpaintState.abortController?.abort();
  inpaintState.abortController = controller;
  inpaintState.generating = true;
  resetInpaintCandidates();
  inpaintState.cropPlan = crop;
  inpaintState.providerMode = providerMode;
  dom.generateInpaint.disabled = true;
  dom.cancelInpaintGeneration?.classList.remove("hidden");
  let completed = 0;
  const generated = [];
  const failures = [];
  try {
    const results = await mapWithConcurrency(Array.from({ length: candidateCount }), 2, async (_, index) => {
      try {
        const response = await callImageAPI(requestPrompt, requestSize, 1, `局部重绘候选 ${index + 1}`, {
          ...requestOptions,
          signal: controller.signal,
          maxRetries: 0,
          preserveRequestedSize: true,
        });
        const sourceUrl = responseImageToDataUrl(response);
        const blob = sourceUrl.startsWith("data:") ? dataUrlToBlob(sourceUrl) : await imageUrlToBlob(sourceUrl);
        const dataUrl = await blobToDataUrl(await normalizeImageBlob(blob));
        const image = await loadImageElement(dataUrl);
        return { dataUrl, image, meta: response._openCodex || null, providerMode };
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        failures.push(interpolate(cleanText("inpaintCandidateFailed"), { index: index + 1, reason: error.message || error }));
        return null;
      } finally {
        completed++;
        setInpaintStatus(interpolate(cleanText("inpaintGenerating"), { done: completed, total: candidateCount }), "info");
      }
    });
    generated.push(...results.filter(Boolean));
    if (!generated.length) throw new Error(failures.join("\n") || "所有候选均生成失败");
    inpaintState.candidates = generated;
    inpaintState.selectedCandidate = 0;
    renderInpaintCandidates();
    renderInpaintPreview();
    dom.inpaintAlignment?.classList.remove("hidden");
    dom.applyInpaint?.classList.remove("hidden");
    setInpaintStatus(
      failures.length ? `已生成 ${generated.length} 个候选；${failures.length} 个失败。` : `已生成 ${generated.length} 个候选。`,
      failures.length ? "info" : "success"
    );
  } catch (error) {
    setInpaintStatus(error?.name === "AbortError" ? "已取消候选生成。" : `局部重绘失败：${error.message || error}`, error?.name === "AbortError" ? "info" : "error");
  } finally {
    inpaintState.generating = false;
    inpaintState.abortController = null;
    dom.generateInpaint.disabled = false;
    dom.cancelInpaintGeneration?.classList.add("hidden");
  }
}

function applyInpaintResult() {
  if (!inpaintState.resultDataUrl || !inpaintState.source || !inpaintState.cropPlan) {
    setInpaintStatus("请先生成并选择候选补丁。", "error");
    return;
  }
  const base64 = inpaintState.resultDataUrl.split(",")[1] || "";
  const panelId = String(generatedImageUrls.length + 1);
  const prompt = String(dom.inpaintPrompt?.value || "").trim();
  const crop = inpaintState.cropPlan;
  const selected = inpaintState.candidates[inpaintState.selectedCandidate];
  const providerMode = inpaintState.providerMode || getInpaintProviderMode();
  const card = addResultPlaceholder(panelId, prompt, {
    mode: "single",
    prompt,
    fullPrompt: prompt,
    size: `${inpaintState.source.width}x${inpaintState.source.height}`,
    references: [],
  });
  const resultPayload = {
    data: [{ b64_json: base64, mime_type: "image/png" }],
  };
  if (providerMode === "opencodex-local-mask") {
    resultPayload._openCodex = {
      provider: "opencodex-local-image",
      operation: "inpaint",
      requested: {
        model: OPENCODEX_GPT_IMAGE_2,
        size: getOpenCodexInpaintRequestSize(crop),
        quality: OPENCODEX_GPT_PRIVATE_QUALITY,
        aspectRatio: crop.aspectRatio,
      },
      response: selected?.meta?.response || { mimeType: "image/png" },
    };
  }
  replacePlaceholder(card, panelId, resultPayload, prompt, {
    mode: "single",
    operation: "inpaint",
    size: `${inpaintState.source.width}x${inpaintState.source.height}`,
    inpaint: {
      sourceName: inpaintState.sourceName,
      crop: { ...crop },
      feather: Number(dom.inpaintFeather?.value || 0),
      context: Number(dom.inpaintContext?.value || 15),
      localMaskComposite: true,
      nativeMask: providerMode === "official-native-mask",
      providerMode,
    },
  });
  dom.emptyState?.classList.add("hidden");
  dom.resultGrid?.classList.remove("hidden");
  dom.resultToolbar?.classList.remove("hidden");
  setInpaintStatus(cleanText("inpaintApplied"), "success");
  closeModal(dom.inpaintModal);
}

dom.openInpaintFromFile?.addEventListener("click", () => {
  if (!getInpaintProviderMode()) {
    showStatus(cleanText("inpaintRequiresGptImage2"), "error");
    return;
  }
  openModal(dom.inpaintModal);
  if (!inpaintState.source) dom.inpaintSourceInput?.click();
});
dom.inpaintChooseSource?.addEventListener("click", () => dom.inpaintSourceInput?.click());
dom.inpaintSourceInput?.addEventListener("change", async () => {
  const file = dom.inpaintSourceInput.files?.[0];
  dom.inpaintSourceInput.value = "";
  if (!file) return;
  try {
    await loadInpaintSourceBlob(file, file.name || "image");
  } catch (error) {
    setInpaintStatus(`读取原图失败：${error.message || error}`, "error");
  }
});
dom.closeInpaint?.addEventListener("click", () => {
  inpaintState.abortController?.abort();
  closeModal(dom.inpaintModal);
});
dom.inpaintBrush?.addEventListener("click", () => setInpaintTool("brush"));
dom.inpaintEraser?.addEventListener("click", () => setInpaintTool("eraser"));
dom.inpaintUndo?.addEventListener("click", () => {
  const action = inpaintState.actions.pop();
  if (action) inpaintState.redoActions.push(action);
  resetInpaintCandidates();
  replayInpaintMask();
});
dom.inpaintRedo?.addEventListener("click", () => {
  const action = inpaintState.redoActions.pop();
  if (action) inpaintState.actions.push(action);
  resetInpaintCandidates();
  replayInpaintMask();
});
dom.inpaintClearMask?.addEventListener("click", () => {
  if (inpaintState.actions.length) inpaintState.redoActions.push(...inpaintState.actions.splice(0));
  resetInpaintCandidates();
  replayInpaintMask();
});
dom.inpaintToggleMask?.addEventListener("click", () => {
  inpaintState.maskVisible = !inpaintState.maskVisible;
  dom.inpaintCanvasStage?.classList.toggle("mask-hidden", !inpaintState.maskVisible);
  dom.inpaintToggleMask.classList.toggle("active", inpaintState.maskVisible);
  dom.inpaintToggleMask.setAttribute("aria-pressed", String(inpaintState.maskVisible));
});
const setInpaintCompare = active => dom.inpaintCanvasStage?.classList.toggle("compare-original", active);
dom.inpaintCompare?.addEventListener("pointerdown", event => {
  event.preventDefault();
  setInpaintCompare(true);
  dom.inpaintCompare.setPointerCapture?.(event.pointerId);
});
["pointerup", "pointercancel", "lostpointercapture"].forEach(type => {
  dom.inpaintCompare?.addEventListener(type, () => setInpaintCompare(false));
});
dom.inpaintZoomFit?.addEventListener("click", () => {
  inpaintState.zoomMode = "fit";
  updateInpaintStageSize();
});
dom.inpaintZoom100?.addEventListener("click", () => {
  inpaintState.zoomMode = "100";
  updateInpaintStageSize();
});
dom.inpaintMaskCanvas?.addEventListener("pointerdown", event => {
  if (!inpaintState.source || event.button !== 0) return;
  event.preventDefault();
  dom.inpaintMaskCanvas.setPointerCapture(event.pointerId);
  inpaintState.activeStroke = {
    tool: inpaintState.tool,
    size: Number(dom.inpaintBrushSize?.value || 48),
    points: [canvasPointFromPointer(event)],
  };
  inpaintState.actions.push(inpaintState.activeStroke);
  inpaintState.redoActions = [];
  resetInpaintCandidates();
  replayInpaintMask();
});
dom.inpaintMaskCanvas?.addEventListener("pointermove", event => {
  if (!inpaintState.activeStroke || !dom.inpaintMaskCanvas.hasPointerCapture?.(event.pointerId)) return;
  const point = canvasPointFromPointer(event);
  const previous = inpaintState.activeStroke.points.at(-1);
  if (Math.hypot(point.x - previous.x, point.y - previous.y) < 1.5) return;
  inpaintState.activeStroke.points.push(point);
  replayInpaintMask();
});
const finishInpaintStroke = event => {
  if (!inpaintState.activeStroke) return;
  if (dom.inpaintMaskCanvas.hasPointerCapture?.(event.pointerId)) dom.inpaintMaskCanvas.releasePointerCapture(event.pointerId);
  inpaintState.activeStroke = null;
  replayInpaintMask();
};
dom.inpaintMaskCanvas?.addEventListener("pointerup", finishInpaintStroke);
dom.inpaintMaskCanvas?.addEventListener("pointercancel", finishInpaintStroke);
dom.inpaintBrushSize?.addEventListener("input", () => {
  if (dom.inpaintBrushSizeValue) dom.inpaintBrushSizeValue.textContent = dom.inpaintBrushSize.value;
});
dom.inpaintFeather?.addEventListener("input", () => {
  if (dom.inpaintFeatherValue) dom.inpaintFeatherValue.textContent = dom.inpaintFeather.value;
  renderInpaintPreview();
});
dom.inpaintContext?.addEventListener("input", () => {
  if (dom.inpaintContextValue) dom.inpaintContextValue.textContent = dom.inpaintContext.value;
  resetInpaintCandidates();
});
[dom.inpaintOffsetX, dom.inpaintOffsetY, dom.inpaintScale].forEach(control => {
  control?.addEventListener("input", () => {
    updateInpaintAlignmentLabels();
    renderInpaintPreview();
  });
});
dom.generateInpaint?.addEventListener("click", () => void generateInpaintCandidates());
dom.applyInpaint?.addEventListener("click", applyInpaintResult);
dom.cancelInpaintGeneration?.addEventListener("click", () => inpaintState.abortController?.abort());
window.addEventListener("resize", () => {
  if (!dom.inpaintModal?.classList.contains("hidden")) updateInpaintStageSize();
});

// 尺寸、数量、分镜和质量都可能改变官方图片输出费用。使用委托监听，兼容动态创建的分镜行。
document.addEventListener("input", () => {
  if (!dom.officialCostSummary?.classList.contains("hidden")) scheduleOfficialCostSummaryUpdate();
});
document.addEventListener("change", () => {
  if (!dom.officialCostSummary?.classList.contains("hidden")) scheduleOfficialCostSummaryUpdate();
});
document.addEventListener("click", event => {
  if (dom.officialCostSummary?.classList.contains("hidden")) return;
  if (event.target.closest(".size-options, #comicPanelSection, #captionSection, #nImagesField, .provider-panel-official")) {
    scheduleOfficialCostSummaryUpdate();
  }
});

dom.openApiConfig?.addEventListener("click", () => {
  keepApiConfigVisible();
  dom.apiEndpoint?.focus();
});

dom.quickDetectModels?.addEventListener("click", () => {
  keepApiConfigVisible();
  dom.detectModels?.click();
});

[dom.apiEndpoint, dom.apiKey, dom.model, dom.proxyEndpoint].forEach(input => {
  input?.addEventListener("input", updateApiQuickState);
  input?.addEventListener("change", updateApiQuickState);
});

// ─── 主题切换 ──────────────────────────────────────────────
const THEME_KEY = "ai_image_gen_theme";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  dom.themeToggle.innerHTML = icon(theme === "light" ? "sun" : "moon");
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute("content", theme === "light" ? "#eef2fb" : "#121417");
  localStorage.setItem(THEME_KEY, theme);
}

// 初始化主题（默认深色）
const savedTheme = localStorage.getItem(THEME_KEY) || "dark";
applyTheme(savedTheme);

dom.themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "light" ? "dark" : "light");
});

// ─── 应用设置 / 弹层 ─────────────────────────────────────────
const SETTINGS_KEY = "ai_image_gen_settings";
const DESKTOP_PROXY_DEFAULT_MODE = "http7890";
const DESKTOP_PROXY_PRESETS = {
  http7890: "http://127.0.0.1:7890",
  socks10808: "socks5://127.0.0.1:10808",
  direct: "",
};

function loadSettings() {
  try {
    return {
      historyEnabled: true,
      historyLimit: 100,
      cacheRetentionDays: 7,
      imageAskEveryTime: false,
      zipAskEveryTime: false,
      retryCount: 3,
      grsaiSubmit504RetryCount: 2,
      grsaiSubmit504RetryInterval: 30,
      desktopProxyMode: DESKTOP_PROXY_DEFAULT_MODE,
      desktopProxyCustomUrl: "",
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
    };
  } catch {
    return { historyEnabled: true, historyLimit: 100, cacheRetentionDays: 7, imageAskEveryTime: false, zipAskEveryTime: false, retryCount: 3, grsaiSubmit504RetryCount: 2, grsaiSubmit504RetryInterval: 30, desktopProxyMode: DESKTOP_PROXY_DEFAULT_MODE, desktopProxyCustomUrl: "" };
  }
}

function saveSettings(next = {}) {
  const current = loadSettings();
  const merged = { ...current, ...next };
  merged.historyLimit = Math.min(500, Math.max(20, Number(merged.historyLimit) || 100));
  merged.cacheRetentionDays = Math.min(365, Math.max(1, Math.round(Number(merged.cacheRetentionDays) || 7)));
  merged.imageAskEveryTime = merged.imageAskEveryTime === true;
  merged.zipAskEveryTime = merged.zipAskEveryTime === true;
  merged.retryCount = clampRetryCount(merged.retryCount);
  merged.grsaiSubmit504RetryCount = clampRetryCount(merged.grsaiSubmit504RetryCount, 2);
  merged.grsaiSubmit504RetryInterval = clampGrsaiSubmit504RetryInterval(merged.grsaiSubmit504RetryInterval);
  merged.desktopProxyMode = normalizeDesktopProxyMode(merged.desktopProxyMode);
  merged.desktopProxyCustomUrl = String(merged.desktopProxyCustomUrl || "").trim();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  applySettings(merged);
  return merged;
}

function applySettings(settings = loadSettings()) {
  if (dom.historyEnabled) dom.historyEnabled.checked = settings.historyEnabled !== false;
  if (dom.historyLimit) dom.historyLimit.value = String(settings.historyLimit || 100);
  if (dom.cacheRetentionDays) dom.cacheRetentionDays.value = String(settings.cacheRetentionDays || 7);
  if (dom.imageAskEveryTime) dom.imageAskEveryTime.checked = settings.imageAskEveryTime === true;
  if (dom.zipAskEveryTime) dom.zipAskEveryTime.checked = settings.zipAskEveryTime === true;
  if (dom.retryCount) dom.retryCount.value = String(clampRetryCount(settings.retryCount));
  if (dom.grsaiSubmit504RetryCount) dom.grsaiSubmit504RetryCount.value = String(clampRetryCount(settings.grsaiSubmit504RetryCount, 2));
  if (dom.grsaiSubmit504RetryInterval) dom.grsaiSubmit504RetryInterval.value = String(clampGrsaiSubmit504RetryInterval(settings.grsaiSubmit504RetryInterval));
  if (dom.desktopProxyMode) dom.desktopProxyMode.value = normalizeDesktopProxyMode(settings.desktopProxyMode);
  if (dom.desktopProxyCustomUrl) dom.desktopProxyCustomUrl.value = String(settings.desktopProxyCustomUrl || "");
  updateDesktopProxyUi(settings);
  if (dom.failedRetryCount && !dom.failedRetryCount.dataset.edited) {
    dom.failedRetryCount.value = String(clampRetryCount(settings.retryCount));
  }
}

function normalizeDesktopProxyMode(mode) {
  return ["http7890", "socks10808", "direct", "custom"].includes(mode)
    ? mode
    : DESKTOP_PROXY_DEFAULT_MODE;
}

function parseDesktopProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return { valid: false, error: cleanText("desktopProxyInvalid") };
  try {
    const url = new URL(raw);
    const protocol = url.protocol.replace(":", "").toLowerCase();
    if (!["http", "https", "socks5"].includes(protocol)) {
      return { valid: false, error: cleanText("desktopProxyInvalid") };
    }
    if (!url.hostname || !url.port || url.username || url.password || !["", "/"].includes(url.pathname)) {
      return { valid: false, error: cleanText("desktopProxyInvalid") };
    }
    return { valid: true, url: `${protocol}://${url.hostname}:${url.port}` };
  } catch {
    return { valid: false, error: cleanText("desktopProxyInvalid") };
  }
}

function resolveDesktopProxyConfig(settings = loadSettings()) {
  const mode = normalizeDesktopProxyMode(settings.desktopProxyMode);
  if (mode === "direct") {
    return { valid: true, mode, proxyMode: "direct", proxyUrl: "", label: cleanText("desktopProxyDirect"), target: "DIRECT" };
  }
  if (mode === "custom") {
    const parsed = parseDesktopProxyUrl(settings.desktopProxyCustomUrl);
    if (!parsed.valid) return { valid: false, mode, proxyMode: "custom", proxyUrl: "", error: parsed.error };
    return { valid: true, mode, proxyMode: "custom", proxyUrl: parsed.url, label: cleanText("desktopProxyCustom"), target: parsed.url };
  }
  const proxyUrl = DESKTOP_PROXY_PRESETS[mode] || DESKTOP_PROXY_PRESETS[DESKTOP_PROXY_DEFAULT_MODE];
  return {
    valid: true,
    mode,
    proxyMode: mode,
    proxyUrl,
    label: cleanText(mode === "socks10808" ? "desktopProxySocks" : "desktopProxyHttp"),
    target: proxyUrl,
  };
}

function getDesktopProxyPayload(options = {}) {
  const config = resolveDesktopProxyConfig(loadSettings());
  if (!config.valid && options.validate) {
    setDesktopProxyStatus(config.error, "error");
    throw new Error(config.error);
  }
  return {
    proxyMode: config.proxyMode,
    proxyUrl: config.proxyUrl,
  };
}

function withDesktopProxyPayload(payload = {}, options = {}) {
  return { ...getDesktopProxyPayload({ validate: options.validate !== false }), ...payload };
}

function setDesktopProxyStatus(message, type = "info", custom = true) {
  if (!dom.desktopProxyStatus) return;
  dom.desktopProxyStatus.textContent = message;
  dom.desktopProxyStatus.dataset.state = type;
  dom.desktopProxyStatus.dataset.customStatus = custom ? "true" : "";
}

function updateDesktopProxyUi(settings = loadSettings()) {
  const mode = normalizeDesktopProxyMode(settings.desktopProxyMode);
  if (dom.desktopProxyCustomUrl) {
    dom.desktopProxyCustomUrl.disabled = mode !== "custom";
    dom.desktopProxyCustomUrl.placeholder = mode === "custom"
      ? "http://127.0.0.1:7890 或 socks5://127.0.0.1:10808"
      : DESKTOP_PROXY_PRESETS[mode] || "";
  }
  if (dom.desktopProxyStatus && !dom.desktopProxyStatus.dataset.customStatus) {
    dom.desktopProxyStatus.textContent = cleanText("desktopProxyHint");
  }
}

async function testDesktopProxy() {
  if (!isNativeDesktopWebview()) {
    setDesktopProxyStatus(cleanText("desktopProxyBrowserOnly"), "info");
    showStatus(cleanText("desktopProxyBrowserOnly"), "info");
    return;
  }
  const config = resolveDesktopProxyConfig(loadSettings());
  if (!config.valid) {
    setDesktopProxyStatus(config.error, "error");
    showStatus(config.error, "error");
    return;
  }
  setDesktopProxyStatus(cleanText("desktopProxyTesting"), "info");
  try {
    const result = await nativeDownload.nativeFetchPayload({
      url: RELEASE_API_URL,
      method: "GET",
      headers: { Accept: "application/vnd.github+json" },
    });
    const status = Number(result?.status || 0);
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status || "?"}`);
    const message = interpolate(cleanText("desktopProxyOk"), { mode: config.label, target: config.target });
    setDesktopProxyStatus(message, "success");
    showStatus(message, "success");
  } catch (err) {
    const message = interpolate(cleanText("desktopProxyFailed"), { reason: err.message || err });
    setDesktopProxyStatus(message, "error");
    showStatus(message, "error");
  }
}

function clampRetryCount(value, fallback = 3) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(10, Math.max(0, Math.floor(num)));
}

function getGlobalRetryCount() {
  return clampRetryCount(loadSettings().retryCount);
}

// 已确认根因：Windows 端 webview_windows 0.4.0 转发鼠标滚轮事件时不带光标坐标信息
// （上游 jnschulze/flutter-webview-windows#313 已修复，但从 2024-02 的 0.4.0 之后再没发布过
// 新版本到 pub.dev），导致 Chromium 无法正确判断"光标下该滚动哪个嵌套容器"，滚轮事件很可能
// 被派发到最外层 document/body——而弹窗打开时 body 被设成 overflow:hidden（见 openModal），
// 于是表现为"整个界面完全没反应"。用一个 document 级委托监听器（在 initManualWheelScrollFix
// 里注册，需要等 nativeDownload 初始化完才能判断平台，所以放在文件末尾启动流程里调用），在
// 事件到达时手动找到光标下最近的可滚动祖先并直接改 scrollTop，绕开原生嵌套滚动派发；用委托
// 而不是给每个滚动容器单独绑定，是因为像历史记录卡片里的滚动区域是运行时动态生成的，没法在
// 启动时枚举完。只在确认受影响的原生 Windows exe 环境下启用，浏览器/PWA 端原生嵌套滚动本来
// 就正常，不需要（也不应该）用 JS 覆盖，避免影响原生的平滑/惯性滚动手感。
function findScrollableAncestor(el) {
  let node = el;
  while (node && node !== document.body && node !== document.documentElement) {
    if (node.nodeType === 1) {
      if (canScrollVertically(node)) return node;
    }
    node = node.parentElement;
  }
  return null;
}

function resolveManualWheelScrollTarget(event) {
  const overlay = getTopVisibleOverlay();
  const targetScroller = findScrollableAncestor(resolveWheelEventStartElement(event));
  if (!overlay) return targetScroller;
  if (targetScroller && overlay.contains(targetScroller)) return targetScroller;
  const overlayScroller = getOverlayPrimaryScroller(overlay);
  if (overlayScroller) return overlayScroller;
  if (targetScroller && !overlay.contains(targetScroller)) return null;
  return targetScroller;
}

function initManualWheelScrollFix() {
  if (!isNativeWindowsWebview() || window.__AI_GEN_WINDOWS_WINDOWED_WEBVIEW) return;
  document.addEventListener("wheel", e => {
    if (e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    const overlay = getTopVisibleOverlay();
    const target = resolveManualWheelScrollTarget(e);
    if (!target && !overlay) return;
    if (target && scrollElementByWheelDelta(target, getWheelDeltaY(e, target))) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!overlay) return;
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false, capture: true });
}

function getFocusableElements(container) {
  return [...(container?.querySelectorAll?.(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ) || [])].filter(el => !el.closest(".hidden") && getComputedStyle(el).visibility !== "hidden");
}

function clampGrsaiSubmit504RetryInterval(value, fallback = 30) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(600, Math.max(1, Math.floor(num)));
}

function getGrsaiSubmit504RetryPolicy() {
  const settings = loadSettings();
  return {
    maxRetries: clampRetryCount(settings.grsaiSubmit504RetryCount, 2),
    intervalSeconds: clampGrsaiSubmit504RetryInterval(settings.grsaiSubmit504RetryInterval),
  };
}

function trapOverlayFocus(event, overlay) {
  if (event.key !== "Tab" || !overlay) return;
  const focusable = getFocusableElements(overlay);
  if (!focusable.length) {
    event.preventDefault();
    overlay.querySelector(".modal-card")?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openModal(modal) {
  if (!modal) return;
  modal._returnFocus = document.activeElement;
  modal.classList.remove("hidden");
  updateBodyScrollLock();
  requestAnimationFrame(() => {
    const focusable = getFocusableElements(modal);
    (focusable[0] || modal.querySelector(".modal-card"))?.focus();
  });
}

function closeModal(modal) {
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  updateBodyScrollLock();
  const returnFocus = modal._returnFocus;
  modal._returnFocus = null;
  if (returnFocus?.isConnected) requestAnimationFrame(() => returnFocus.focus());
}

document.addEventListener("keydown", event => {
  if (event.key === "Tab") trapOverlayFocus(event, getTopVisibleOverlay());
}, true);

// ─── 自定义确认/输入弹窗 ─────────────────────────────────────
// 部分 WebView 环境（安卓 WebView 未接管 onJsConfirm/onJsPrompt 时默认静默返回 false/null，
// Windows WebView2 则可能弹出脱离页面样式的原生对话框并阻塞渲染进程）不能可靠支持原生
// confirm()/prompt()，因此用页面内弹窗统一替代，保证全端行为一致。
function openAskDialog({ message, kind = "confirm", defaultValue = "" }) {
  return new Promise(resolve => {
    const returnFocus = document.activeElement;
    const isPrompt = kind === "prompt";
    const overlay = document.createElement("div");
    overlay.className = "modal ask-dialog-overlay";
    overlay.innerHTML = `
      <div class="modal-card ask-dialog-card" role="alertdialog" aria-modal="true">
        <p class="ask-dialog-message"></p>
        ${isPrompt ? '<input type="text" class="ask-dialog-input">' : ""}
        <div class="ask-dialog-actions">
          <button type="button" class="btn btn-sm ask-dialog-cancel">取消</button>
          <button type="button" class="btn btn-sm btn-primary ask-dialog-ok">确定</button>
        </div>
      </div>`;
    overlay.querySelector(".ask-dialog-message").textContent = message;
    const input = overlay.querySelector(".ask-dialog-input");
    if (input) input.value = defaultValue || "";

    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      overlay.remove();
      updateBodyScrollLock();
      if (returnFocus?.isConnected) returnFocus.focus();
      resolve(value);
    };
    const onKeydown = e => {
      trapOverlayFocus(e, overlay);
      if (e.key === "Escape") { e.preventDefault(); finish(isPrompt ? null : false); }
      else if (e.key === "Enter") { e.preventDefault(); finish(isPrompt ? input.value : true); }
    };
    overlay.querySelector(".ask-dialog-cancel").addEventListener("click", () => finish(isPrompt ? null : false));
    overlay.querySelector(".ask-dialog-ok").addEventListener("click", () => finish(isPrompt ? input.value : true));
    overlay.addEventListener("click", e => { if (e.target === overlay) finish(isPrompt ? null : false); });
    document.addEventListener("keydown", onKeydown, true);

    document.body.appendChild(overlay);
    updateBodyScrollLock();
    (input || overlay.querySelector(".ask-dialog-ok"))?.focus();
    input?.select();
  });
}

function askConfirm(message) {
  return openAskDialog({ message, kind: "confirm" });
}

function askPrompt(message, defaultValue = "") {
  return openAskDialog({ message, kind: "prompt", defaultValue });
}

dom.settingsBtn?.addEventListener("click", () => openModal(dom.settingsModal));
dom.closeSettings?.addEventListener("click", () => closeModal(dom.settingsModal));
dom.settingsModal?.addEventListener("click", e => { if (e.target === dom.settingsModal) closeModal(dom.settingsModal); });
dom.historyEnabled?.addEventListener("change", () => saveSettings({ historyEnabled: dom.historyEnabled.checked }));
dom.historyLimit?.addEventListener("change", () => saveSettings({ historyLimit: dom.historyLimit.value }));
dom.cacheRetentionDays?.addEventListener("change", () => {
  saveSettings({ cacheRetentionDays: dom.cacheRetentionDays.value });
  void cleanupGeneratedImageCache({ updateStatus: true });
});
dom.imageAskEveryTime?.addEventListener("change", () => saveSettings({ imageAskEveryTime: dom.imageAskEveryTime.checked }));
dom.zipAskEveryTime?.addEventListener("change", () => saveSettings({ zipAskEveryTime: dom.zipAskEveryTime.checked }));
dom.clearGeneratedCache?.addEventListener("click", () => void clearGeneratedImageCacheFromSettings());
dom.retryCount?.addEventListener("change", () => saveSettings({ retryCount: dom.retryCount.value }));
dom.grsaiSubmit504RetryCount?.addEventListener("change", () => saveSettings({ grsaiSubmit504RetryCount: dom.grsaiSubmit504RetryCount.value }));
dom.grsaiSubmit504RetryInterval?.addEventListener("change", () => saveSettings({ grsaiSubmit504RetryInterval: dom.grsaiSubmit504RetryInterval.value }));
dom.desktopProxyMode?.addEventListener("change", () => {
  dom.desktopProxyStatus && (dom.desktopProxyStatus.dataset.customStatus = "");
  saveSettings({ desktopProxyMode: dom.desktopProxyMode.value });
});
dom.desktopProxyCustomUrl?.addEventListener("change", () => {
  dom.desktopProxyStatus && (dom.desktopProxyStatus.dataset.customStatus = "");
  saveSettings({ desktopProxyCustomUrl: dom.desktopProxyCustomUrl.value });
});
dom.testDesktopProxy?.addEventListener("click", () => void testDesktopProxy());
dom.failedRetryCount?.addEventListener("input", () => { dom.failedRetryCount.dataset.edited = "true"; });
dom.failedRetryCount?.addEventListener("change", getFailedRetryCount);
dom.enqueueRemainingFailed?.addEventListener("click", () => {
  const run = retryAllFailedRun;
  if (!run || run.cancelRequested) return;
  const added = enqueueFailedCardsForRetryRun(run, getUntrackedFailedCards(run));
  showStatus(added > 0
    ? interpolate(cleanText("remainingFailedAdded"), { count: added })
    : cleanText("noRemainingFailed"), added > 0 ? "success" : "info");
  updateFailedRetryTools();
});
dom.retryFailedAll?.addEventListener("click", retryAllFailedResults);

let textContextTarget = null;

function isPromptTextTarget(target) {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false;
  if (target.disabled || target.readOnly) return false;
  return target.matches("#prompt, #bulkPromptText") || !!target.closest("#panelTbody, #captionTbody");
}

function closeTextContextMenu() {
  dom.textContextMenu?.classList.add("hidden");
  textContextTarget = null;
}

function openTextContextMenu(target, x, y) {
  if (!dom.textContextMenu) return;
  textContextTarget = target;
  dom.textContextMenu.classList.remove("hidden");
  dom.textContextMenu.style.left = "0px";
  dom.textContextMenu.style.top = "0px";
  requestAnimationFrame(() => {
    if (!dom.textContextMenu || dom.textContextMenu.classList.contains("hidden")) return;
    const rect = dom.textContextMenu.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    dom.textContextMenu.style.left = `${left}px`;
    dom.textContextMenu.style.top = `${top}px`;
    dom.textContextMenu.querySelector("button")?.focus({ preventScroll: true });
  });
}

function dispatchTextEdit(target) {
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
}

async function writeTextClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const copied = document.execCommand("copy");
    helper.remove();
    if (!copied) throw new Error("无法访问系统剪贴板");
  }
}

async function runTextContextAction(action) {
  const target = textContextTarget;
  if (!target?.isConnected) return closeTextContextMenu();
  const start = Number.isFinite(target.selectionStart) ? target.selectionStart : 0;
  const end = Number.isFinite(target.selectionEnd) ? target.selectionEnd : start;
  const selected = target.value.slice(start, end);
  try {
    if (action === "selectAll") {
      target.focus();
      target.select();
      return;
    }
    if (action === "copy") {
      await writeTextClipboard(selected);
      return;
    }
    if (action === "cut") {
      await writeTextClipboard(selected);
      target.setRangeText("", start, end, "end");
      dispatchTextEdit(target);
      return;
    }
    if (action === "paste") {
      if (!navigator.clipboard?.readText) throw new Error("当前系统不允许读取剪贴板");
      const pasted = await navigator.clipboard.readText();
      target.setRangeText(pasted, start, end, "end");
      dispatchTextEdit(target);
    }
  } catch (err) {
    showStatus(`剪贴板操作失败：${err.message || err}`, "error");
  } finally {
    closeTextContextMenu();
  }
}

document.addEventListener("contextmenu", e => {
  if (!isPromptTextTarget(e.target)) return;
  e.preventDefault();
  openTextContextMenu(e.target, e.clientX, e.clientY);
});
dom.textContextMenu?.addEventListener("click", e => {
  const button = e.target.closest("[data-text-action]");
  if (!button) return;
  void runTextContextAction(button.dataset.textAction);
});
document.addEventListener("pointerdown", e => {
  if (!dom.textContextMenu?.classList.contains("hidden") && !dom.textContextMenu.contains(e.target)) closeTextContextMenu();
}, true);
window.addEventListener("resize", closeTextContextMenu);
document.addEventListener("scroll", closeTextContextMenu, true);
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  closeTextContextMenu();
  closeModal(dom.settingsModal);
  closeModal(dom.historyModal);
});
applySettings();

function normalizeVersion(value) {
  return String(value || "0.0.0")
    .trim()
    .replace(/^v/i, "")
    .split(/[+-]/)[0]
    .replace(/[^\d.].*$/, "") || "0.0.0";
}

function compareVersions(a, b) {
  const pa = normalizeVersion(a).split(".").map(part => Number(part) || 0);
  const pb = normalizeVersion(b).split(".").map(part => Number(part) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

function getRuntimePlatform() {
  const nativePlatform = String(window.__AI_GEN_NATIVE_PLATFORM || "").toLowerCase();
  if (["android", "ios", "windows", "macos"].includes(nativePlatform)) return nativePlatform;
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/windows/i.test(ua)) return "windows";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/macintosh|mac os x/i.test(ua)) return "macos";
  return "web";
}

function getUpdateActionKey(platform = getRuntimePlatform()) {
  if (platform === "windows") return "installUpdate";
  if (platform === "android" || platform === "ios") return "openReleasePage";
  return "downloadUpdate";
}

// 是否运行在打包后的 Windows exe 里，而不是纯浏览器/PWA。
// 旧 texture 壳的兼容逻辑还会读取这个判定；windowed 壳另有能力标记。
function isNativeWindowsWebview() {
  return nativeDownload.available() && getRuntimePlatform() === "windows";
}

function isNativeDesktopWebview() {
  return nativeDownload.available() && ["windows", "macos", "linux"].includes(getRuntimePlatform());
}

// 只有旧 texture Windows 壳不支持 OS 级拖放。当前 windowed WebView2 壳与浏览器都支持。
function isDragDropUnsupported() {
  return isNativeWindowsWebview() && !window.__AI_GEN_WINDOWS_WINDOWED_WEBVIEW;
}

function selectUpdateAsset(release, platform = getRuntimePlatform()) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  if (!assets.length) return null;
  const byName = matcher => assets.find(asset => matcher.test(String(asset.name || "")));
  const platformCandidates = {
    android: [/android.*\.apk$/i, /\.apk$/i],
    windows: [/windows.*\.exe$/i, /setup.*\.exe$/i, /\.exe$/i],
    macos: [/macos.*\.zip$/i, /darwin.*\.zip$/i],
    ios: [/ios.*\.zip$/i],
  };
  const candidates = platformCandidates[platform] || [/setup.*\.exe$/i, /\.apk$/i, /\.zip$/i];
  for (const matcher of candidates) {
    const asset = byName(matcher);
    if (asset?.browser_download_url) return asset;
  }
  if (platformCandidates[platform]) return null;
  return assets.find(asset => asset?.browser_download_url) || null;
}

function selectChecksumAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets.find(asset => /^sha256sums(?:\.txt)?$/i.test(String(asset?.name || ""))) || null;
}

function parseReleaseChecksum(text, fileName) {
  const wanted = String(fileName || "").trim();
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    let match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match && match[2].replace(/^\.\//, "").trim() === wanted) return match[1].toLowerCase();
    match = line.match(/^SHA256\s*\((.+)\)\s*=\s*([a-f0-9]{64})$/i);
    if (match && match[1].trim() === wanted) return match[2].toLowerCase();
  }
  return "";
}

async function fetchReleaseChecksum(release, fileName) {
  const checksumAsset = selectChecksumAsset(release);
  if (!checksumAsset?.browser_download_url) {
    throw new Error(`Release 缺少 SHA256SUMS.txt，已阻止安装 ${fileName}`);
  }
  const response = await smartFetch(checksumAsset.browser_download_url, { cache: "no-store" });
  if (!response.ok) throw new Error(`SHA-256 校验表下载失败：HTTP ${response.status}`);
  const expected = parseReleaseChecksum(await response.text(), fileName);
  if (!expected) throw new Error(`SHA256SUMS.txt 中找不到 ${fileName}`);
  return expected;
}

function setUpdateStatus(message, type = "info", custom = true) {
  if (!dom.updateStatus) return;
  dom.updateStatus.textContent = message;
  dom.updateStatus.dataset.customStatus = custom ? "true" : "";
  dom.updateStatus.dataset.state = type;
}

function updateInstallButtonState(busy = false) {
  if (dom.checkUpdates) dom.checkUpdates.disabled = !!busy;
  const knownNoUpdate = latestUpdateInfo && latestUpdateInfo.isNewer === false;
  if (dom.installUpdate) dom.installUpdate.disabled = !!busy || knownNoUpdate;
}

function setUpdateButtonsBusy(busy) {
  updateInstallButtonState(!!busy);
}

function updateReleaseDetails(info) {
  if (dom.updateAssetLabel) {
    const asset = info?.release ? selectUpdateAsset(info.release) : null;
    dom.updateAssetLabel.textContent = asset?.name || cleanText("notChecked");
  }
  if (dom.updateNotes) {
    const notes = String(info?.release?.body || "").trim();
    dom.updateNotes.value = notes;
    dom.updateNotes.placeholder = cleanText("releaseNotesPlaceholder");
  }
}

function setLatestUpdateInfo(info) {
  latestUpdateInfo = info || null;
  latestUpdateRelease = latestUpdateInfo?.release || null;
  updateReleaseDetails(latestUpdateInfo);
  updateInstallButtonState(false);
}

async function fetchLatestReleaseInfo() {
  const response = await smartFetch(RELEASE_API_URL, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function checkForUpdates(options = {}) {
  const silent = !!options.silent;
  if (!silent) {
    setUpdateButtonsBusy(true);
    setUpdateStatus(cleanText("checkingUpdates"));
  }
  try {
    const release = await fetchLatestReleaseInfo();
    const latest = normalizeVersion(release.tag_name || release.name || "");
    if (dom.currentVersionLabel) dom.currentVersionLabel.textContent = `v${APP_VERSION}`;
    if (dom.latestVersionLabel) dom.latestVersionLabel.textContent = latest ? `v${latest}` : cleanText("notChecked");
    const isNewer = compareVersions(latest, APP_VERSION) > 0;
    const info = { release, latest, isNewer };
    try {
      const state = JSON.parse(localStorage.getItem(UPDATE_CHECK_STATE_KEY) || "{}");
      localStorage.setItem(UPDATE_CHECK_STATE_KEY, JSON.stringify({ ...state, lastCheckedAt: Date.now() }));
    } catch {}
    setLatestUpdateInfo(info);
    const message = isNewer
      ? interpolate(cleanText("updateAvailable"), { version: `v${latest}` })
      : cleanText("noUpdate");
    setUpdateStatus(message, isNewer ? "success" : "info");
    if (!silent) showStatus(message, isNewer ? "success" : "info");
    return info;
  } catch (err) {
    const message = `${cleanText("updateCheckFailed")}: ${err.message || err}`;
    setUpdateStatus(message, "error");
    if (!silent) showStatus(message, "error");
    throw err;
  } finally {
    if (!silent) setUpdateButtonsBusy(false);
  }
}

async function downloadLatestUpdate(install = false) {
  setUpdateButtonsBusy(true);
  setUpdateStatus(cleanText("downloadingUpdate"));
  try {
    const info = latestUpdateRelease
      ? (latestUpdateInfo || { release: latestUpdateRelease, latest: normalizeVersion(latestUpdateRelease.tag_name || latestUpdateRelease.name || ""), isNewer: compareVersions(latestUpdateRelease.tag_name || latestUpdateRelease.name || "", APP_VERSION) > 0 })
      : await checkForUpdates({ silent: true });
    if (!info.isNewer) {
      setUpdateStatus(cleanText("noUpdate"), "info");
      showStatus(cleanText("noUpdate"), "info");
      return { skipped: true, reason: "up-to-date", latest: info.latest };
    }

    // 手机端（安卓）不做应用内下载/覆盖安装：只跳转到 GitHub 发布页，用户在浏览器/系统里自行下载安装。
    // 桌面端（Windows/macOS）继续走原生下载 + 覆盖安装。
    if (["android", "ios"].includes(getRuntimePlatform())) {
      const releaseUrl = info.release?.html_url || `https://github.com/2786886095/Langbai-api-image-Studio/releases/tag/v${info.latest}`;
      await openExternalUrl(releaseUrl);
      setUpdateStatus(cleanText("updateOpenGithubMobile"), "info");
      showStatus(cleanText("updateOpenGithubMobile"), "info");
      return { opened: true, url: releaseUrl };
    }

    const asset = selectUpdateAsset(info.release);
    if (!asset) throw new Error(cleanText("noUpdateAsset"));
    const url = asset.browser_download_url;
    const fileName = asset.name || `AI-Image-Generator-${info.latest || Date.now()}.zip`;
    const expectedSha256 = await fetchReleaseChecksum(info.release, fileName);

    if (nativeDownload.available() && typeof nativeDownload.downloadUpdate === "function") {
      const result = await nativeDownload.downloadUpdate(url, fileName, install, getRuntimePlatform(), expectedSha256);
      const path = result?.path || fileName;
      if (install && result?.installerStarted) {
        setUpdateStatus(cleanText("updateInstallStarted"), "success");
        showStatus(cleanText("updateInstallStarted"), "success");
      } else {
        const message = interpolate(cleanText("updateDownloaded"), { path });
        setUpdateStatus(message, "success");
        showStatus(message, "success");
      }
      return result;
    }

    await openExternalUrl(url);
    setUpdateStatus(cleanText("updateOpenRelease"), "info");
    showStatus(cleanText("updateOpenRelease"), "info");
    return { opened: true, url };
  } catch (err) {
    const actionKey = install ? getUpdateActionKey() : "downloadUpdate";
    const message = `${cleanText(actionKey)}: ${err.message || err}`;
    setUpdateStatus(message, "error");
    showStatus(message, "error");
    throw err;
  } finally {
    setUpdateButtonsBusy(false);
  }
}

if (dom.currentVersionLabel) dom.currentVersionLabel.textContent = `v${APP_VERSION}`;
if (dom.latestVersionLabel) dom.latestVersionLabel.textContent = cleanText("notChecked");
dom.checkUpdates?.addEventListener("click", () => void checkForUpdates());
dom.installUpdate?.addEventListener("click", () => void downloadLatestUpdate(true));
window.AiGenUpdate = {
  APP_VERSION,
  checkForUpdates,
  downloadLatestUpdate,
  compareVersions,
  selectUpdateAsset,
  selectChecksumAsset,
  parseReleaseChecksum,
  getRuntimePlatform,
};
window.AiGenProxy = { resolveDesktopProxyConfig, getDesktopProxyPayload, withDesktopProxyPayload, parseDesktopProxyUrl };

// ─── 已知模型价格（跨平台通用） ─────────────────────────────
const GRSAI_GPT_IMAGE_MODELS = Object.freeze([
  "gpt-image-2",
  "gpt-image-2-vip",
]);
const GRSAI_NANO_BANANA_MODELS = Object.freeze([
  "nano-banana",
  "nano-banana-fast",
  "nano-banana-2",
  "nano-banana-2-cl",
  "nano-banana-2-2k-cl",
  "nano-banana-2-4k-cl",
  "nano-banana-pro",
  "nano-banana-pro-vt",
  "nano-banana-pro-cl",
  "nano-banana-pro-vip",
  "nano-banana-pro-4k-vip",
]);
const GRSAI_OFFICIAL_MODELS = Object.freeze([
  ...GRSAI_GPT_IMAGE_MODELS,
  ...GRSAI_NANO_BANANA_MODELS,
]);
const GRSAI_POLL_INTERVAL_MS = 2000;
const GRSAI_POLL_GATEWAY_DELAY_MAX_MS = 30000;

const KNOWN_PRICES = {
  "gpt-image-2": "¥0.03/张", "gpt-image-2-vip": "¥0.065/张",
  "nano-banana-fast": "¥0.022~0.044/次", "nano-banana": "¥0.07~0.14/次",
  "nano-banana-2": "¥0.06~0.12/次", "nano-banana-2-cl": "¥0.08~0.16/次",
  "nano-banana-2-4k-cl": "¥0.15~0.3/次",
  "nano-banana-pro": "¥0.09~0.18/次", "nano-banana-pro-vt": "¥0.09~0.18/次",
  "nano-banana-pro-cl": "¥0.3~0.6/次", "nano-banana-pro-vip": "¥0.5~1/次",
  "nano-banana-pro-4k-vip": "¥0.8~1.6/次",
  "gpt-image-1": "¥0.02/张",
  "dall-e-3": "¥0.04/张", "dall-e-2": "¥0.02/张",
  "gemini-2.5-flash-image": "¥0.022/张", "gemini-3.1-flash-image": "¥0.06/张",
  "gemini-3-pro-image-preview": "¥0.09/张",
  "flux-1.1-pro": "¥0.05/张", "flux-dev": "¥0.03/张", "flux-schnell": "¥0.01/张",
  "stable-diffusion-3.5-large": "¥0.04/张", "stable-diffusion-xl": "¥0.02/张",
  "midjourney-v7": "¥0.06/张", "midjourney-v6": "¥0.05/张",
  "imagen-3": "¥0.04/张",
  "gpt-4o": "¥17/M", "gpt-4o-mini": "¥1/M", "gpt-4-turbo": "¥70/M",
  "gpt-3.5-turbo": "¥3/M", "o3-mini": "¥8/M", "o1": "¥105/M",
  "claude-3-5-sonnet": "¥21/M", "claude-3-opus": "¥105/M", "claude-3-haiku": "¥1.7/M",
  "gemini-2.5-pro": "¥9/M", "gemini-2.5-flash": "¥1/M", "gemini-2.0-flash": "¥0.7/M",
  "deepseek-chat": "¥1/M", "deepseek-reasoner": "¥4/M",
  "qwen-max": "¥3/M", "qwen-plus": "¥1.5/M",
  "llama-3-70b": "¥5/M", "llama-3-8b": "¥0.5/M",
};

function priceLabel(modelId) {
  const p = KNOWN_PRICES[modelId];
  return p ? ` · ${p}` : "";
}

function setModelChoices(models = [], options = {}) {
  const ids = [...new Set(models.map(item => {
    if (typeof item === "string") return item.trim();
    return String(item?.id || item?.value || "").trim();
  }).filter(Boolean))];
  if (!dom.modelChoices) return ids;
  dom.modelChoices.innerHTML = "";
  if (!ids.length) {
    dom.model?.classList.remove("has-model-choices");
    return ids;
  }
  dom.modelChoices.appendChild(new Option(cleanText("modelChoicesPlaceholder"), ""));
  ids.slice(0, options.limit || 80).forEach(id => {
    dom.modelChoices.appendChild(new Option(id + (options.showPrices === false ? "" : priceLabel(id)), id));
  });
  dom.modelChoices.value = "";
  dom.model?.classList.add("has-model-choices");
  return ids;
}

// ─── 内置模型列表（兜底用）─────────────────────────────────
function loadFallbackModels() {
  const ids = Object.keys(KNOWN_PRICES).filter(k => !/nano-banana|gpt-image-2-vip/.test(k));
  setModelChoices(ids);
  dom.model.value = "";
  dom.model.placeholder = `已加载 ${ids.length} 个模型，点击选择`;
  updateApiQuickState();
}

function loadGrsaiModels() {
  const ids = GRSAI_OFFICIAL_MODELS;
  setModelChoices(ids);
  dom.model.value = "";
  dom.model.placeholder = `已加载 ${ids.length} 个 GrsAI 模型，点击选择`;
  updateApiQuickState();
}

function loadOfficialModels(models = OPENAI_OFFICIAL_IMAGE_MODELS) {
  const ids = [...new Set((models || []).filter(isOpenAiOfficialImageModelId))];
  const choices = ids.length ? ids : [...OPENAI_OFFICIAL_IMAGE_MODELS];
  const current = dom.model.value.trim();
  setModelChoices(choices, { showPrices: false });
  dom.model.value = choices.includes(current) ? current : (choices.includes("gpt-image-2") ? "gpt-image-2" : choices[0] || "gpt-image-2");
  dom.model.placeholder = `已加载 ${choices.length} 个 OpenAI 官方生图模型，点击选择`;
  updateOfficialOptionAvailability();
  updateApiQuickState();
  scheduleOfficialCostSummaryUpdate();
  return choices;
}

// 模型变更时提示价格 + 自动更新已保存配置
dom.model.addEventListener("change", () => {
  const m = dom.model.value.trim();
  updateOfficialOptionAvailability();
  if (KNOWN_PRICES[m]) showStatus(`已选: ${m} · ${KNOWN_PRICES[m]}`, "info");
  persistCurrentProviderOptions();
  updateApiQuickState();
  scheduleOfficialCostSummaryUpdate();
});

// ─── 检测模型（适配器路由）─────────────────────────────────
dom.detectModels.addEventListener("click", detectModelsForAdapter);

dom.toggleKey.addEventListener("click", () => {
  const input = dom.apiKey;
  const isPw = input.type === "password";
  input.type = isPw ? "text" : "password";
  dom.toggleKey.innerHTML = icon(isPw ? "eye-off" : "eye");
});

// 端点变化时自动检测平台并加载对应模型
dom.apiEndpoint.addEventListener("change", () => {
  const ep = dom.apiEndpoint.value.trim();
  const provider = dom.apiProvider?.value || inferApiProvider(ep);
  const selected = getSelectedSavedApiConfig();
  if (selected && !apiConfigIdentityMatches(selected, provider, ep)) {
    detachSavedApiProfile();
    saveConfig(currentApiConfig(apiProviderLabel(provider), { forceNew: true }));
  }
  if (provider !== "custom") {
    applyApiProvider(provider, { forceEndpoint: false });
  }
  if (provider === "grsai") {
    loadGrsaiModels();
    dom.model.placeholder = "点击输入或检测选择模型";
  } else if (provider === "official") {
    loadOfficialModels();
  } else if (/jeniya\.top/.test(ep)) {
    dom.model.placeholder = "点击输入或检测选择模型";
  } else {
    dom.model.placeholder = "gpt-image-2";
  }
});

// ═══════════════════════════════════════════════════════════
//  模式切换
// ═══════════════════════════════════════════════════════════

dom.modeTabs.addEventListener("click", (e) => {
  const tab = e.target.closest(".mode-tab");
  if (!tab) return;
  const mode = tab.dataset.mode;
  if (mode === currentMode) return;
  switchMode(mode);
});
dom.modeTabs.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = $$(".mode-tab", dom.modeTabs);
  if (!tabs.length) return;
  event.preventDefault();
  const currentIndex = Math.max(0, tabs.indexOf(document.activeElement));
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  const next = tabs[nextIndex];
  switchMode(next.dataset.mode);
  next.focus();
});

// 头部导出按钮
$("#exportBtn")?.addEventListener("click", () => void handleExportAction());

// GrsAI 推荐地址一键填入
$("#useGrsaiEndpoint")?.addEventListener("click", () => {
  if (dom.apiEndpoint) {
    detachSavedApiProfile();
    applyApiProvider("grsai", { forceEndpoint: true });
    dom.apiEndpoint.value = GRSAI_API_ENDPOINT;
    dom.apiEndpoint.focus();
    saveConfig(currentApiConfig(apiProviderLabel("grsai"), { forceNew: true }));
    updateApiQuickState();
  }
});

function getExportableHistoryCount() {
  return loadHistory().filter(item => {
    if (isHistoryProject(item)) return getHistoryImages(item).length > 0;
    return !!(item?.imageUrl || item?.url);
  }).length;
}

async function handleExportAction() {
  const images = getCurrentResultImages();
  if (images.length > 0) {
    dom.resultToolbar?.classList.remove("hidden");
    await downloadAllAsZip();
    return;
  }

  if (getExportableHistoryCount() > 0) {
    renderHistory();
    openModal(dom.historyModal);
    showStatus(cleanText("exportOpenedHistory"), "info");
    return;
  }

  showStatus(cleanText("noImagesToExport"), "error");
}

function switchMode(mode) {
  currentMode = mode;
  if (abortController) stopCurrentGeneration();
  $$(".mode-tab", dom.modeTabs).forEach(t => {
    const selected = t.dataset.mode === mode;
    t.classList.toggle("active", selected);
    t.setAttribute("aria-selected", selected ? "true" : "false");
    t.tabIndex = selected ? 0 : -1;
  });

  const isComic = mode === "comic";
  const isCaption = mode === "caption";
  dom.comicSection.classList.toggle("hidden", !isComic);
  dom.captionSection.classList.toggle("hidden", !isCaption);
  dom.nImagesField.classList.toggle("hidden", isComic || isCaption);
  dom.referenceField.classList.toggle("hidden", isCaption);
  updateSizePolicyUi();
  dom.saveComicFolder.classList.toggle("hidden", !(isComic || isCaption));
  dom.progressWrap.classList.toggle("hidden", true);

  const label = $("#globalPromptField .field-label-text");
  if (label) label.textContent = tr(isComic ? "全局提示词（注入所有分镜）" : isCaption ? "全局提示词（注入所有图片）" : "提示词");

  setButtonText(dom.generateBtn, "spark", isComic ? "generateAll" : isCaption ? "generateAllCaptions" : "generateImage");

  if (isComic) {
    dom.promptHint.textContent = tr("全局提示词将拼接在每个分镜提示词前面");
    if (dom.panelTbody.children.length === 0) addPanelRow();
  } else if (isCaption) {
    dom.promptHint.textContent = tr("全局提示词将拼接在每张图片的气泡文字前面");
  } else {
    dom.promptHint.textContent = "";
  }

  applyCleanLanguage();
  scheduleOfficialCostSummaryUpdate();
  clearStatus();
}

function refreshLocalizedUiState() {
  const isComic = currentMode === "comic";
  const isCaption = currentMode === "caption";
  const label = $("#globalPromptField .field-label-text");
  if (label) label.textContent = tr(isComic ? "全局提示词（注入所有分镜）" : isCaption ? "全局提示词（注入所有图片）" : "提示词");
  if (dom.promptHint) dom.promptHint.textContent = isComic ? tr("全局提示词将拼接在每个分镜提示词前面") : isCaption ? tr("全局提示词将拼接在每张图片的气泡文字前面") : "";
  setButtonText(dom.generateBtn, "spark", isComic ? "generateAll" : isCaption ? "generateAllCaptions" : "generateImage");
  setButtonText(dom.detectModels, "search", "detect");
  setButtonText(dom.downloadZip, "zip", "downloadZip");
  setButtonText(dom.saveComicFolder, "folder", "saveToFolder");
}

// ═══════════════════════════════════════════════════════════
//  txt 文件导入
// ═══════════════════════════════════════════════════════════

dom.importTxt.addEventListener("click", e => {
  e.preventDefault();
  e.stopPropagation();
  openFileInputOnce(dom.txtFileInput);
});
dom.txtFileInput.addEventListener("change", () => {
  const files = [...dom.txtFileInput.files];
  if (files.length === 0) return;

  let loaded = 0;
  const newFiles = [];

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = () => {
      newFiles.push({ name: file.name, content: reader.result });
      loaded++;
      if (loaded === files.length) {
        newFiles.forEach(f => {
          if (!importedTxtFiles.find(x => x.name === f.name)) {
            importedTxtFiles.push(f);
          }
        });
        renderTxtBadges();
        showStatus(`已导入 ${files.length} 个文本参考 ✅`, "success");
      }
    };
    reader.readAsText(file, "UTF-8");
  });
  dom.txtFileInput.value = "";
});

function removeTxtFile(index) {
  importedTxtFiles.splice(index, 1);
  renderTxtBadges();
}

function renderTxtBadges() {
  dom.txtFileBadges.innerHTML = "";
  if (importedTxtFiles.length === 0) {
    dom.txtFileBadges.classList.add("hidden");
    return;
  }
  dom.txtFileBadges.classList.remove("hidden");
  importedTxtFiles.forEach((f, i) => {
    const badge = document.createElement("span");
    badge.className = "file-badge";
    badge.innerHTML = `
      <span class="file-badge-icon">${icon("file")}</span>
      <span class="file-badge-name">${escapeHtml(f.name)}</span>
      <button class="file-badge-clear" data-index="${i}">✕</button>`;
    badge.querySelector(".file-badge-clear").addEventListener("click", () => removeTxtFile(i));
    dom.txtFileBadges.appendChild(badge);
  });
}

function getEffectivePrompt() {
  const parts = [];
  if (importedTxtFiles.length > 0) {
    parts.push(importedTxtFiles.map(f => f.content).join("\n\n"));
  }
  if (dom.prompt.value.trim()) {
    parts.push(dom.prompt.value.trim());
  }
  return parts.join("\n\n");
}

const MAX_REFERENCE_FILES = 100;
const MAX_REFERENCE_FILE_BYTES = 25 * 1024 * 1024;
const MAX_REFERENCE_TOTAL_BYTES = 250 * 1024 * 1024;

function validateImageImport(files, existingCount = 0, { maxFiles = MAX_REFERENCE_FILES } = {}) {
  const imageFiles = [...files].filter(file => file?.type?.startsWith("image/"));
  if (Number.isFinite(maxFiles) && existingCount + imageFiles.length > maxFiles) {
    throw new Error(`参考图最多 ${maxFiles} 张，当前选择会达到 ${existingCount + imageFiles.length} 张`);
  }
  const oversized = imageFiles.find(file => Number(file.size || 0) > MAX_REFERENCE_FILE_BYTES);
  if (oversized) throw new Error(`${oversized.name || "图片"} 超过单张 25 MB 限制`);
  const totalBytes = imageFiles.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (totalBytes > MAX_REFERENCE_TOTAL_BYTES) throw new Error("本次图片总大小超过 250 MB，请分批导入");
  return imageFiles;
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function readImageReference(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("请选择有效的图片文件"));
      return;
    }
    if (Number(file.size || 0) > MAX_REFERENCE_FILE_BYTES) {
      reject(new Error(`${file.name || "图片"} 超过单张 25 MB 限制`));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`读取图片失败：${file.name || "未知文件"}`));
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onerror = () => reject(new Error(`图片解析失败：${file.name || "未知文件"}`));
      img.onload = () => resolve({
        file,
        fileName: file.name || "reference.png",
        dataUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function dedupeReferences(refs = []) {
  const seen = new Set();
  return refs.filter(ref => {
    if (!ref?.dataUrl || seen.has(ref.dataUrl)) return false;
    seen.add(ref.dataUrl);
    return true;
  });
}

function sortReferencesByName(refs = []) {
  return [...refs].sort((a, b) => {
    const nameA = a?.fileName || a?.file?.name || "";
    const nameB = b?.fileName || b?.file?.name || "";
    return nameA.localeCompare(nameB, "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function getPanelRequestReferences(panel) {
  return dedupeReferences([...(panel.references || []), ...referenceImages]);
}

// 参考图对象里的 file 是浏览器 File，JSON.stringify 存进 localStorage 时会变成没用的 {}——
// 存历史记录前只留可序列化、恢复项目时真正用得上的字段。
function serializableReferences(refs) {
  return (refs || []).map(({ fileName, dataUrl, width, height }) => ({ fileName, dataUrl, width, height }));
}

// ═══════════════════════════════════════════════════════════
//  全局参考图片上传
// ═══════════════════════════════════════════════════════════

dom.uploadZone.addEventListener("click", e => {
  e.preventDefault();
  e.stopPropagation();
  openFileInputOnce(dom.refImage);
});
dom.uploadZone.addEventListener("dragover", e => { e.preventDefault(); dom.uploadZone.classList.add("drag-over"); });
dom.uploadZone.addEventListener("dragleave", () => dom.uploadZone.classList.remove("drag-over"));
dom.uploadZone.addEventListener("drop", e => {
  e.preventDefault();
  dom.uploadZone.classList.remove("drag-over");
  const files = [...e.dataTransfer.files].filter(f => f.type.startsWith("image/"));
  addReferenceImages(files);
});
dom.refImage.addEventListener("change", () => {
  const files = [...dom.refImage.files].filter(f => f.type.startsWith("image/"));
  addReferenceImages(files);
  dom.refImage.value = "";
});

async function addReferenceImages(files) {
  try {
    const imageFiles = validateImageImport(files, referenceImages.length);
    if (imageFiles.length === 0) return;
    const refs = await mapWithConcurrency(imageFiles, 4, readImageReference);
    const before = referenceImages.length;
    referenceImages = sortReferencesByName(dedupeReferences([...referenceImages, ...refs]));
    const added = referenceImages.length - before;

    renderThumbGrid();
    if (added > 0) {
      showStatus(`已添加 ${added} 张参考图（共 ${referenceImages.length} 张）`, "success");
    } else {
      showStatus("这些参考图已经导入过了", "info");
    }
  } catch (err) {
    showStatus(err.message || "参考图导入失败", "error");
  }
}

function removeReferenceImage(index) {
  referenceImages.splice(index, 1);
  renderThumbGrid();
}

function renderThumbGrid() {
  dom.thumbGrid.innerHTML = "";
  if (referenceImages.length === 0) {
    dom.thumbGrid.classList.add("hidden");
    dom.uploadZone.classList.remove("hidden");
    return;
  }
  dom.thumbGrid.classList.remove("hidden");
  dom.uploadZone.classList.add("hidden");

  referenceImages.forEach((ref, i) => {
    const label = `参考图 ${i + 1}: ${ref.fileName || "未命名图片"}`;
    const item = document.createElement("div");
    item.className = "thumb-item";
    item.title = label;
    item.innerHTML = `
      <img src="${ref.dataUrl}" alt="${escapeHtml(label)}">
      <span class="thumb-index">${i + 1}</span>
      <button class="btn-clear" title="移除">✕</button>`;
    item.querySelector(".btn-clear").addEventListener("click", (e) => {
      e.stopPropagation();
      removeReferenceImage(i);
    });
    dom.thumbGrid.appendChild(item);
  });

  const addBtn = document.createElement("div");
  addBtn.className = "thumb-add";
  addBtn.textContent = "+";
  addBtn.title = "添加更多参考图";
  addBtn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    openFileInputOnce(dom.refImage);
  });
  dom.thumbGrid.appendChild(addBtn);
}

// ═══════════════════════════════════════════════════════════
//  分辨率
// ═══════════════════════════════════════════════════════════

dom.customWidth.addEventListener("focus", () => {
  const r = document.querySelector('input[name="size"][value="custom"]');
  if (r) r.checked = true;
});
dom.customHeight.addEventListener("focus", () => {
  const r = document.querySelector('input[name="size"][value="custom"]');
  if (r) r.checked = true;
});

function getSelectedSize() {
  const checked = document.querySelector('input[name="size"]:checked');
  if (!checked || checked.value !== "custom") return checked ? checked.value : "1024x1024";
  const w = parseInt(dom.customWidth.value) || 1024;
  const h = parseInt(dom.customHeight.value) || 1024;
  return `${w}x${h}`;
}

const SAVED_SIZES_KEY = "ai_image_gen_saved_sizes";

function parseSizeValue(size) {
  const match = String(size || "").match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!match) return null;
  const width = Math.min(4096, Math.max(64, Number(match[1]) || 1024));
  const height = Math.min(4096, Math.max(64, Number(match[2]) || 1024));
  return { width, height, value: `${width}x${height}` };
}

function loadSavedSizes() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_SIZES_KEY) || "[]");
    return Array.isArray(raw)
      ? raw.map(item => {
          const parsed = parseSizeValue(item.value);
          return parsed ? { name: item.name || parsed.value.replace("x", "×"), value: parsed.value } : null;
        }).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function saveSavedSizes(list) {
  localStorage.setItem(SAVED_SIZES_KEY, JSON.stringify(list));
}

function renderSavedSizes() {
  if (!dom.savedSizes) return;
  const selected = dom.savedSizes.value;
  dom.savedSizes.innerHTML = `<option value="">${cleanText("savedSizes")}</option>`;
  loadSavedSizes().forEach(size => {
    const opt = document.createElement("option");
    opt.value = size.value;
    opt.textContent = `${size.name} · ${size.value.replace("x", "×")}`;
    dom.savedSizes.appendChild(opt);
  });
  if (selected && dom.savedSizes.querySelector(`option[value="${selected}"]`)) {
    dom.savedSizes.value = selected;
  }
  customSelects.savedSizes?.syncLabel();
}

function applySizeValue(size) {
  const parsed = parseSizeValue(size);
  if (!parsed) return false;
  const builtin = document.querySelector(`input[name="size"][value="${parsed.value}"]`);
  if (builtin) {
    builtin.checked = true;
  } else {
    const custom = document.querySelector('input[name="size"][value="custom"]');
    if (custom) custom.checked = true;
    dom.customWidth.value = String(parsed.width);
    dom.customHeight.value = String(parsed.height);
  }
  return true;
}

dom.saveSizePreset?.addEventListener("click", async () => {
  const parsed = parseSizeValue(getSelectedSize());
  if (!parsed) {
    showStatus("当前尺寸无效，宽高需要在 64 到 4096 之间", "error");
    return;
  }
  const defaultName = parsed.value.replace("x", "×");
  const name = await askPrompt("给这个常用尺寸起个名字：", defaultName);
  if (name === null) return;
  const sizes = loadSavedSizes();
  const item = { name: (name || defaultName).trim() || defaultName, value: parsed.value };
  const idx = sizes.findIndex(size => size.value === item.value);
  if (idx >= 0) sizes[idx] = item;
  else sizes.push(item);
  saveSavedSizes(sizes.slice(0, 24));
  renderSavedSizes();
  dom.savedSizes.value = item.value;
  showStatus(`已保存常用尺寸: ${item.name}`, "success");
});

dom.savedSizes?.addEventListener("change", () => {
  if (!dom.savedSizes.value) return;
  if (applySizeValue(dom.savedSizes.value)) {
    showStatus(`已应用尺寸: ${dom.savedSizes.value.replace("x", "×")}`, "info");
  }
});

dom.deleteSizePreset?.addEventListener("click", () => {
  const selected = dom.savedSizes?.value;
  if (!selected) return;
  const sizes = loadSavedSizes();
  const next = sizes.filter(size => size.value !== selected);
  saveSavedSizes(next);
  renderSavedSizes();
  showStatus(`已删除常用尺寸: ${selected.replace("x", "×")}`, "info");
});

renderSavedSizes();

// ═══════════════════════════════════════════════════════════
//  分镜表格 CRUD
// ═══════════════════════════════════════════════════════════

const panelRowTemplate = $("#panelRowTemplate");

function syncPanelCountInput() {
  if (!dom.panelCount) return;
  const count = dom.panelTbody.children.length;
  dom.panelCount.value = String(Math.max(1, count));
}

// 恢复项目、批量导入等场景需要在创建行的同时就把参考图套上去，跟人工上传共用同一份
// 渲染逻辑，避免出现"两条路径各画一遍缩略图，改一处忘了改另一处"的情况。
function applyPanelRowImage(row, ref) {
  const imgPreview = row.querySelector(".panel-img-preview");
  const imgName = row.querySelector(".panel-img-name");
  const imgClear = row.querySelector(".panel-img-clear");
  row._panelReference = ref;
  imgPreview.style.backgroundImage = `url("${ref.dataUrl}")`;
  imgPreview.classList.remove("hidden");
  imgName.textContent = ref.fileName;
  imgName.title = ref.fileName;
  imgClear.classList.remove("hidden");
}

function addPanelRow(prefilledRef = null, { syncCount = true } = {}) {
  panelCounter++;
  const clone = panelRowTemplate.content.cloneNode(true);
  const row = clone.querySelector(".panel-row");

  row.querySelector(".panel-num").textContent = panelCounter;
  row.dataset.panelId = panelCounter;

  row.querySelector(".delete-panel").addEventListener("click", () => {
    row.remove();
    renumberPanels();
  });

  const imgInput = row.querySelector(".panel-img-input");
  const imgBtn = row.querySelector(".panel-img-btn");
  const imgPreview = row.querySelector(".panel-img-preview");
  const imgName = row.querySelector(".panel-img-name");
  const imgClear = row.querySelector(".panel-img-clear");

  imgBtn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    openFileInputOnce(imgInput);
  });
  imgInput.addEventListener("change", async () => {
    const file = imgInput.files[0];
    if (file && file.type.startsWith("image/")) {
      const readTask = readImageReference(file);
      row._panelReferenceTask = readTask;
      imgBtn.disabled = true;
      imgName.textContent = "读取中";
      try {
        const ref = await readTask;
        if (imgInput.files[0] !== file) return;
        applyPanelRowImage(row, ref);
        showStatus(`分镜 ${row.dataset.panelId} 已绑定参考图`, "success");
      } catch (err) {
        row._panelReference = null;
        imgInput.value = "";
        imgName.textContent = "";
        imgName.title = "";
        imgPreview.style.backgroundImage = "";
        imgPreview.classList.add("hidden");
        imgClear.classList.add("hidden");
        showStatus(err.message || "分镜参考图读取失败", "error");
      } finally {
        if (row._panelReferenceTask === readTask) row._panelReferenceTask = null;
        imgBtn.disabled = false;
      }
    }
  });
  imgClear.addEventListener("click", () => {
    imgInput.value = "";
    row._panelReference = null;
    row._panelReferenceTask = null;
    imgPreview.style.backgroundImage = "";
    imgPreview.classList.add("hidden");
    imgName.textContent = "";
    imgName.title = "";
    imgClear.classList.add("hidden");
  });

  if (prefilledRef) applyPanelRowImage(row, prefilledRef);

  dom.panelTbody.appendChild(row);
  if (syncCount) syncPanelCountInput();
  return row;
}

function renumberPanels() {
  $$(".panel-row", dom.panelTbody).forEach((row, i) => {
    row.querySelector(".panel-num").textContent = i + 1;
    row.dataset.panelId = i + 1;
  });
  panelCounter = dom.panelTbody.children.length;
  syncPanelCountInput();
}

function rowHasPanelContent(row) {
  return !!(
    row.querySelector("textarea")?.value.trim() ||
    row.querySelector(".panel-size-w")?.value ||
    row.querySelector(".panel-size-h")?.value ||
    row.querySelector(".panel-retry-count")?.value ||
    row._panelReference ||
    row.querySelector(".panel-img-input")?.files?.length
  );
}

function getPanelRetryCount(row) {
  const raw = row.querySelector(".panel-retry-count")?.value;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  return clampRetryCount(raw, getGlobalRetryCount());
}

function getRequestedPanelCount() {
  const raw = Number(dom.panelCount?.value);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.floor(raw));
}

async function setPanelCount(targetCount) {
  const target = Math.max(1, Math.floor(Number(targetCount) || 1));
  const rows = $$(".panel-row", dom.panelTbody);
  const current = rows.length;

  if (current === target) {
    showStatus(`当前已经是 ${target} 个分镜`, "info");
    syncPanelCountInput();
    return;
  }

  if (target > current) {
    for (let i = current; i < target; i++) {
      addPanelRow(null, { syncCount: false });
      if ((i - current + 1) % 100 === 0) await new Promise(requestAnimationFrame);
    }
    syncPanelCountInput();
    showStatus(`已创建 ${target} 个分镜`, "success");
    return;
  }

  const rowsToRemove = rows.slice(target);
  const hasContent = rowsToRemove.some(rowHasPanelContent);
  if (hasContent && !(await askConfirm(`将删除后面的 ${current - target} 个分镜及其内容，确定继续吗？`))) {
    syncPanelCountInput();
    return;
  }

  rowsToRemove.forEach(row => row.remove());
  renumberPanels();
  showStatus(`已调整为 ${target} 个分镜`, "success");
}

dom.createPanels?.addEventListener("click", async () => {
  const target = getRequestedPanelCount();
  if (dom.panelCount) dom.panelCount.value = String(target);
  await setPanelCount(target);
});
dom.panelCount?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    dom.createPanels?.click();
  }
});

dom.addPanel.addEventListener("click", () => addPanelRow());
dom.clearPanels.addEventListener("click", async () => {
  if (dom.panelTbody.children.length === 0 && !abortController) return;
  if (await askConfirm("确定清空所有分镜？")) {
    const wasGenerating = !!abortController;
    stopCurrentGeneration("已取消当前生成并清空分镜");
    dom.panelTbody.innerHTML = "";
    panelCounter = 0;
    syncPanelCountInput();
    if (wasGenerating) {
      dom.resultGrid.innerHTML = "";
      dom.resultGrid.classList.add("hidden");
      dom.emptyState.classList.remove("hidden");
      dom.resultToolbar.classList.add("hidden");
      generatedImageUrls = [];
      updateFailedRetryTools();
    }
  }
});

dom.captionUploadZone.addEventListener("click", e => {
  e.preventDefault();
  e.stopPropagation();
  openFileInputOnce(dom.captionBulkInput);
});
dom.captionUploadZone.addEventListener("dragover", e => { e.preventDefault(); dom.captionUploadZone.classList.add("drag-over"); });
dom.captionUploadZone.addEventListener("dragleave", () => dom.captionUploadZone.classList.remove("drag-over"));
dom.captionUploadZone.addEventListener("drop", e => {
  e.preventDefault();
  dom.captionUploadZone.classList.remove("drag-over");
  addCaptionRowsFromFiles(e.dataTransfer.files);
});
dom.captionBulkInput.addEventListener("change", () => {
  addCaptionRowsFromFiles(dom.captionBulkInput.files);
  dom.captionBulkInput.value = "";
});

[dom.uploadZone, dom.captionUploadZone].forEach(zone => {
  zone?.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    zone.click();
  });
});
dom.clearCaptionRows.addEventListener("click", async () => {
  if (dom.captionTbody.children.length === 0 && !abortController) return;
  if (await askConfirm("确定清空所有嵌字行？")) {
    const wasGenerating = !!abortController;
    stopCurrentGeneration("已取消当前生成并清空嵌字行");
    dom.captionTbody.innerHTML = "";
    captionRowCounter = 0;
    if (wasGenerating) {
      dom.resultGrid.innerHTML = "";
      dom.resultGrid.classList.add("hidden");
      dom.emptyState.classList.remove("hidden");
      dom.resultToolbar.classList.add("hidden");
      generatedImageUrls = [];
      updateFailedRetryTools();
    }
  }
});

const AUTO_FILL_TEMPLATE_LABELS = {
  "panel-output": "输出分镜 N 的图片",
  "ref-bubble-number": "参考图 N 加编号气泡",
  "ref-caption-number": "参考图 N 加文字编号",
  custom: "自定义模板",
};

function renderAutoFillTemplate(template, vars) {
  return template
    .split("{n}").join(vars.n)
    .split("{ref}").join(vars.ref)
    .split("{caption}").join(vars.caption);
}

function getAutoFillPrompt(row, customTemplate = "") {
  const n = row.querySelector(".panel-num").textContent;
  const refIndex = n;
  const vars = { n, ref: refIndex, caption: n };
  const templateType = dom.autoFillTemplate?.value || "panel-output";

  if (templateType === "ref-bubble-number") {
    return renderAutoFillTemplate("给参考图{ref}加入{caption}的气泡字幕", vars);
  }
  if (templateType === "ref-caption-number") {
    return renderAutoFillTemplate("给参考图{ref}加入醒目的文字编号{caption}", vars);
  }
  if (templateType === "custom") {
    return renderAutoFillTemplate(customTemplate, vars);
  }
  return renderAutoFillTemplate("输出分镜{n}的图片", vars);
}

dom.autoFillPanels.addEventListener("click", async () => {
  const templateType = dom.autoFillTemplate?.value || "panel-output";
  const shouldMatchReferenceCount = /^ref-/.test(templateType) && referenceImages.length > 0;

  if (shouldMatchReferenceCount && dom.panelTbody.children.length < referenceImages.length) {
    const rows = $$(".panel-row", dom.panelTbody);
    const hasContent = rows.some(rowHasPanelContent);
    if (!hasContent || (await askConfirm(`当前有 ${referenceImages.length} 张参考图，是否扩展为 ${referenceImages.length} 个分镜？`))) {
      await setPanelCount(referenceImages.length);
    }
  } else if (dom.panelTbody.children.length === 0 && referenceImages.length > 0) {
    referenceImages.forEach(() => addPanelRow());
  }

  const rows = $$(".panel-row", dom.panelTbody);
  if (rows.length === 0) {
    showStatus("请先添加分镜", "info"); return;
  }

  const hasContent = rows.some(row => row.querySelector("textarea").value.trim());
  if (hasContent && !(await askConfirm("已有分镜提示词，确定用当前模板覆盖吗？"))) return;

  let customTemplate = "";
  if (dom.autoFillTemplate?.value === "custom") {
    customTemplate = (await askPrompt("输入模板：可用 {n} 表示分镜编号，{ref} 表示参考图编号，{caption} 表示字幕内容", "给参考图{ref}加入{caption}的气泡字幕")) || "";
    if (!customTemplate.trim()) return;
  }

  rows.forEach(row => {
    row.querySelector("textarea").value = getAutoFillPrompt(row, customTemplate.trim());
  });
  const label = AUTO_FILL_TEMPLATE_LABELS[dom.autoFillTemplate?.value || "panel-output"] || "当前模板";
  showStatus(`已按「${label}」填写 ${rows.length} 个分镜`, "success");
});

const CAPTION_AUTO_FILL_TEMPLATE_LABELS = {
  "numbered-bubble": "编号气泡",
  custom: "自定义模板",
};

function getCaptionAutoFillText(row, customTemplate = "") {
  const n = row.querySelector(".panel-num").textContent;
  const vars = { n, ref: n, caption: n };
  const templateType = dom.captionAutoFillTemplate?.value || "numbered-bubble";

  if (templateType === "custom") {
    return renderAutoFillTemplate(customTemplate, vars);
  }
  // 气泡的位置/颜色/样式交给全局提示词统一描述（全局提示词里说明"气泡文字对应下面的编号"即可），
  // 这里只需要一句明确指令 AI 给该图加气泡字幕、并带上编号即可，不重复限定样式。
  return renderAutoFillTemplate("给图片加入{n}的气泡字幕", vars);
}

dom.autoFillCaptionRows.addEventListener("click", async () => {
  const rows = $$(".caption-row", dom.captionTbody);
  if (rows.length === 0) {
    showStatus("请先批量上传图片", "info"); return;
  }

  const hasContent = rows.some(row => row.querySelector(".caption-text").value.trim());
  if (hasContent && !(await askConfirm("已有气泡文字，确定用当前模板覆盖吗？"))) return;

  let customTemplate = "";
  if (dom.captionAutoFillTemplate?.value === "custom") {
    customTemplate = (await askPrompt("输入模板：可用 {n} 表示图片编号", "{n}")) || "";
    if (!customTemplate.trim()) return;
  }

  rows.forEach(row => {
    row.querySelector(".caption-text").value = getCaptionAutoFillText(row, customTemplate.trim());
  });
  const label = CAPTION_AUTO_FILL_TEMPLATE_LABELS[dom.captionAutoFillTemplate?.value || "numbered-bubble"] || "当前模板";
  showStatus(`已按「${label}」填写 ${rows.length} 张图片`, "success");
});

// ─── 批量提示词：每行严格占一个位置，内部空行不能过滤，否则后续图片会错位。 ───
let bulkPromptMode = "comic";

function parseBulkPromptLines(value) {
  const normalized = String(value ?? "").replace(/\r\n?/g, "\n");
  if (!normalized) return [];
  const lines = normalized.split("\n");
  // 粘贴文本常带一个结尾换行；只移除这一个，额外空行仍视为用户明确保留的位置。
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

function getBulkPromptRows(mode = bulkPromptMode) {
  return mode === "caption"
    ? $$(".caption-row", dom.captionTbody)
    : $$(".panel-row", dom.panelTbody);
}

function getBulkPromptInput(row, mode = bulkPromptMode) {
  return mode === "caption" ? row.querySelector(".caption-text") : row.querySelector("textarea");
}

function bulkPromptUnit(mode = bulkPromptMode) {
  if (currentLanguage === "en") return mode === "caption" ? "images" : "panels";
  if (currentLanguage === "ja") return mode === "caption" ? "枚の画像" : "コマ";
  if (currentLanguage === "ko") return mode === "caption" ? "이미지" : "콘티";
  if (currentLanguage === "zh-Hant") return mode === "caption" ? "張圖片" : "個分鏡";
  return mode === "caption" ? "张图片" : "个分镜";
}

function updateBulkPromptCount() {
  if (!dom.bulkPromptCount) return;
  const lines = parseBulkPromptLines(dom.bulkPromptText?.value).length;
  const rows = getBulkPromptRows().length;
  dom.bulkPromptCount.textContent = interpolate(cleanText("bulkPromptCount"), {
    lines,
    rows,
    unit: bulkPromptUnit(),
  });
  dom.bulkPromptCount.classList.toggle("is-warning", bulkPromptMode === "caption" && lines > rows);
}

function updateBulkPromptDialogLanguage() {
  if (!dom.bulkPromptModal) return;
  const isCaption = bulkPromptMode === "caption";
  dom.bulkPromptTitle.textContent = cleanText(isCaption ? "bulkCaptionTitle" : "bulkComicTitle");
  dom.bulkPromptHint.textContent = cleanText(isCaption ? "bulkCaptionHint" : "bulkComicHint");
  dom.bulkPromptText.placeholder = cleanText("bulkPromptPlaceholder");
  dom.cancelBulkPrompts.textContent = cleanText("cancel");
  setButtonText(dom.applyBulkPrompts, "spark", "applyBulkPrompts");
  updateBulkPromptCount();
}

function openBulkPromptDialog(mode) {
  bulkPromptMode = mode === "caption" ? "caption" : "comic";
  dom.bulkPromptText.value = "";
  dom.bulkPromptCount.classList.remove("is-error", "is-warning");
  updateBulkPromptDialogLanguage();
  openModal(dom.bulkPromptModal);
  requestAnimationFrame(() => dom.bulkPromptText.focus());
}

function setBulkPromptDialogError(message) {
  dom.bulkPromptCount.textContent = message;
  dom.bulkPromptCount.classList.add("is-error");
}

async function applyBulkPromptLines() {
  const lines = parseBulkPromptLines(dom.bulkPromptText.value);
  if (!lines.length || !lines.some(line => line.trim())) {
    setBulkPromptDialogError(cleanText("noBulkPrompts"));
    return;
  }
  let rows = getBulkPromptRows();
  if (bulkPromptMode === "caption" && rows.length === 0) {
    setBulkPromptDialogError(cleanText("noCaptionImages"));
    return;
  }
  if (bulkPromptMode === "caption" && lines.length > rows.length) {
    setBulkPromptDialogError(interpolate(cleanText("tooManyCaptionPrompts"), { lines: lines.length, rows: rows.length }));
    return;
  }
  if (bulkPromptMode === "comic" && lines.length > rows.length) {
    await setPanelCount(lines.length);
    rows = getBulkPromptRows();
  }

  const targetRows = rows.slice(0, lines.length);
  const wouldOverwrite = targetRows.some((row, index) => {
    const current = getBulkPromptInput(row)?.value || "";
    return current.trim() && current !== lines[index];
  });
  if (wouldOverwrite && !(await askConfirm(cleanText("overwriteBulkPrompts")))) return;

  targetRows.forEach((row, index) => {
    const input = getBulkPromptInput(row);
    input.value = lines[index];
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const remaining = Math.max(0, rows.length - lines.length);
  let message = interpolate(cleanText("bulkPromptsApplied"), { count: targetRows.length });
  if (remaining) {
    message += interpolate(cleanText("bulkPromptsRemaining"), { count: remaining, unit: bulkPromptUnit() });
  }
  closeModal(dom.bulkPromptModal);
  showStatus(message, "success");
}

dom.bulkInputPanelPrompts?.addEventListener("click", () => openBulkPromptDialog("comic"));
dom.bulkInputCaptionPrompts?.addEventListener("click", () => openBulkPromptDialog("caption"));
dom.bulkPromptText?.addEventListener("input", () => {
  dom.bulkPromptCount.classList.remove("is-error");
  updateBulkPromptCount();
});
dom.applyBulkPrompts?.addEventListener("click", () => void applyBulkPromptLines());
[dom.closeBulkPrompts, dom.cancelBulkPrompts].forEach(button => {
  button?.addEventListener("click", () => closeModal(dom.bulkPromptModal));
});
dom.bulkPromptModal?.addEventListener("click", event => {
  if (event.target === dom.bulkPromptModal) closeModal(dom.bulkPromptModal);
});
dom.bulkPromptModal?.addEventListener("keydown", event => {
  if (event.key === "Escape") closeModal(dom.bulkPromptModal);
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void applyBulkPromptLines();
  }
});

function collectPanels() {
  return $$(".panel-row", dom.panelTbody).map(row => ({
    id: row.dataset.panelId,
    prompt: row.querySelector("textarea").value.trim(),
    size: (() => {
      const w = row.querySelector(".panel-size-w")?.value;
      const h = row.querySelector(".panel-size-h")?.value;
      return (w && h) ? `${w}x${h}` : "";
    })(),
    imgFile: row.querySelector(".panel-img-input").files[0],
    references: row._panelReference ? [row._panelReference] : [],
    referenceTask: row._panelReferenceTask || null,
    retryCount: getPanelRetryCount(row),
  }));
}

async function waitForPanelReferenceTasks(panels) {
  const pending = panels.map(p => p.referenceTask).filter(Boolean);
  if (pending.length === 0) return;
  showStatus(`正在读取 ${pending.length} 张分镜参考图…`, "info");
  await Promise.allSettled(pending);
}

// ═══════════════════════════════════════════════════════════
//  嵌字表格 CRUD
// ═══════════════════════════════════════════════════════════

const captionRowTemplate = $("#captionRowTemplate");

function applyCaptionRowImage(row, ref) {
  const imgPreview = row.querySelector(".panel-img-preview");
  const imgThumb = row.querySelector(".caption-img-thumb");
  row._captionReference = ref;
  imgPreview.style.backgroundImage = `url("${ref.dataUrl}")`;
  imgPreview.classList.remove("hidden");
  imgThumb.title = ref.fileName;
}

function addCaptionRow(prefilledRef = null) {
  captionRowCounter++;
  const clone = captionRowTemplate.content.cloneNode(true);
  const row = clone.querySelector(".caption-row");

  row.querySelector(".panel-num").textContent = captionRowCounter;
  row.dataset.captionId = captionRowCounter;

  row.querySelector(".delete-panel").addEventListener("click", () => {
    row.remove();
    renumberCaptionRows();
  });

  const imgInput = row.querySelector(".panel-img-input");
  const imgThumb = row.querySelector(".caption-img-thumb");
  const imgPreview = row.querySelector(".panel-img-preview");

  imgThumb.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    openFileInputOnce(imgInput);
  });
  imgInput.addEventListener("change", async () => {
    const file = imgInput.files[0];
    if (file && file.type.startsWith("image/")) {
      const readTask = readImageReference(file);
      row._captionReferenceTask = readTask;
      imgThumb.disabled = true;
      try {
        const ref = await readTask;
        if (imgInput.files[0] !== file) return;
        applyCaptionRowImage(row, ref);
        showStatus(`第 ${row.dataset.captionId} 张已绑定图片`, "success");
      } catch (err) {
        row._captionReference = null;
        imgInput.value = "";
        imgThumb.title = "点击替换图片";
        imgPreview.style.backgroundImage = "";
        imgPreview.classList.add("hidden");
        showStatus(err.message || "图片读取失败", "error");
      } finally {
        if (row._captionReferenceTask === readTask) row._captionReferenceTask = null;
        imgThumb.disabled = false;
      }
    }
  });

  if (prefilledRef) applyCaptionRowImage(row, prefilledRef);

  dom.captionTbody.appendChild(row);
  return row;
}

async function addCaptionRowsFromFiles(fileList) {
  try {
    const imageFiles = validateImageImport(fileList, dom.captionTbody.children.length, { maxFiles: Infinity });
    if (imageFiles.length === 0) return;
    const refs = sortReferencesByName(await mapWithConcurrency(imageFiles, 4, readImageReference));
    refs.forEach(ref => addCaptionRow(ref));
    showStatus(`已添加 ${refs.length} 张图片（共 ${dom.captionTbody.children.length} 张）`, "success");
  } catch (err) {
    showStatus(err.message || "批量导入图片失败", "error");
  }
}

function renumberCaptionRows() {
  $$(".caption-row", dom.captionTbody).forEach((row, i) => {
    row.querySelector(".panel-num").textContent = i + 1;
    row.dataset.captionId = i + 1;
  });
  captionRowCounter = dom.captionTbody.children.length;
}

function collectCaptionRows() {
  return $$(".caption-row", dom.captionTbody).map(row => ({
    id: row.dataset.captionId,
    captionText: row.querySelector(".caption-text").value.trim(),
    reference: row._captionReference || null,
    referenceTask: row._captionReferenceTask || null,
  }));
}

async function waitForCaptionReferenceTasks(rows) {
  const pending = rows.map(r => r.referenceTask).filter(Boolean);
  if (pending.length === 0) return;
  showStatus(`正在读取 ${pending.length} 张图片…`, "info");
  await Promise.allSettled(pending);
}

// ═══════════════════════════════════════════════════════════
//  状态提示 & 加载
// ═══════════════════════════════════════════════════════════

function showStatus(msg, type) {
  dom.status.textContent = translateTextValue(msg);
  dom.status.className = `status ${type}`;
}
function clearStatus() {
  dom.status.textContent = "";
  dom.status.className = "status hidden";
}
function showLoading(text = "正在生成中……") {
  dom.loadingText.textContent = tr(text);
  dom.loadingOverlay.classList.remove("hidden");
  dom.emptyState.classList.add("hidden");
  dom.resultGrid.classList.add("hidden");
}
function hideLoading() {
  dom.loadingOverlay.classList.add("hidden");
}

function resetGenerateButton() {
  dom.generateBtn.disabled = false;
  dom.generateBtn.classList.remove("is-cancel");
  setButtonText(dom.generateBtn, "spark", currentMode === "comic" ? "generateAll" : currentMode === "caption" ? "generateAllCaptions" : "generateImage");
  syncOpenCodexGenerateAvailability();
}

function beginGeneration() {
  cancelRetryAllFailedRun({ announce: false });
  activeGenerationId++;
  if (abortController) abortController.abort();
  abortController = new AbortController();
  // 按钮保持可点击，但换成"取消生成"——点它会走 stopCurrentGeneration()，
  // 而不是像以前那样直接禁用、生成过程中完全没有办法主动打断。
  dom.generateBtn.disabled = false;
  dom.generateBtn.classList.add("is-cancel");
  setButtonText(dom.generateBtn, "x", "cancelGeneration");
  return {
    id: activeGenerationId,
    signal: abortController.signal,
  };
}

function isGenerationCurrent(run) {
  return !!run && run.id === activeGenerationId && !run.signal?.aborted;
}

function stopCurrentGeneration(message = "") {
  cancelRetryAllFailedRun({ announce: false });
  activeGenerationId++;
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  hideLoading();
  dom.progressWrap.classList.add("hidden");
  updateProgress(0, 0, "");
  resetGenerateButton();
  if (message) showStatus(message, "info");
}

// ═══════════════════════════════════════════════════════════
//  平台适配器注册表
// ═══════════════════════════════════════════════════════════

const adapters = [];

function registerAdapter(adapter) { adapters.push(adapter); }
function findAdapter(endpoint, provider = dom.apiProvider?.value || inferApiProvider(endpoint)) {
  const url = String(endpoint || "").toLowerCase();
  const selectedProvider = API_PROVIDER_PRESETS[provider] ? provider : "custom";
  if (selectedProvider === "official") {
    return adapters.find(a => a.provider === "official") || null;
  }
  if (selectedProvider === "opencodex") {
    return adapters.find(a => a.provider === "opencodex") || null;
  }
  if (selectedProvider === "grsai") {
    return adapters.find(a => a.provider === "grsai") || null;
  }
  for (const a of adapters) {
    if (a.provider) continue;
    if (a.detect(url)) return a;
  }
  return null;
}

registerAdapter({
  name: "OpenCodex 本地生图",
  provider: "opencodex",
  sizeFormat: "pixel",
  supportsReference: true,
  concurrency: 5,
  getConcurrency() {
    return getOpenCodexConcurrency();
  },

  async fetchModels() {
    if (!(await checkOpenCodexHealth({ announce: false, force: true }))) {
      throw new Error("OpenCodex 本地服务未启动。请先启动 OpenCodex，或执行 ocx ensure。");
    }
    setModelChoices(OPENCODEX_MODELS);
    dom.model.value = getOpenCodexImageOptions().model;
    showStatus(`OpenCodex · ${OPENCODEX_CAPABILITIES[dom.model.value]?.label || dom.model.value}`, "success");
  },

  async generate(endpoint, apiKey, model, prompt, size, n, hasRef, refs = [], options = {}) {
    const signal = options.signal;
    throwIfAborted(signal);
    if (!(await checkOpenCodexHealth({ announce: false, force: false }))) {
      throw new Error("OpenCodex 本地服务未启动。请先启动 OpenCodex，或执行 ocx ensure。");
    }
    const selected = normalizeOpenCodexImageOptions(options.openCodexOptions || getOpenCodexImageOptions());
    const selectedModel = OPENCODEX_MODELS.includes(model) ? model : selected.model;
    const capability = OPENCODEX_CAPABILITIES[selectedModel];
    if (!capability) throw new Error(`OpenCodex 不支持模型：${selectedModel}`);
    if (!String(prompt || "").trim()) throw new Error("提示词不能为空");
    if (Number(n) !== 1) throw new Error("OpenCodex 单次请求固定 n=1；批量生图由客户端并发多个请求。");
    if (hasRef && refs.length > capability.maxReferences) {
      throw new Error(`${capability.label} 客户端最多发送 ${capability.maxReferences} 张参考图。`);
    }
    if (hasRef && refs.some(ref => !/^data:image\/(?:png|jpe?g|webp);base64,/i.test(String(ref?.dataUrl || "")))) {
      throw new Error("OpenCodex 参考图必须是 PNG、JPEG 或 WebP Data URL，不能发送远程 URL。");
    }
    const requested = { model: selectedModel, n: 1 };
    const body = { model: selectedModel, prompt: String(prompt).trim(), n: 1 };
    if (selectedModel === OPENCODEX_GPT_IMAGE_2) {
      validateOfficialImageSize(OPENCODEX_GPT_IMAGE_2, size);
      const aspectTarget = getOpenCodexGptAspectTarget(size);
      Object.assign(body, {
        prompt: addOpenCodexGptAspectInstruction(prompt, size),
        size,
        quality: OPENCODEX_GPT_PRIVATE_QUALITY,
        background: selected.background,
      });
      Object.assign(requested, {
        size,
        quality: OPENCODEX_GPT_PRIVATE_QUALITY,
        background: selected.background,
        aspectRatio: aspectTarget?.ratio || null,
        privateOutputPixelsObserved: OPENCODEX_GPT_PRIVATE_MAX_PIXELS_OBSERVED,
        privateMaxEdgeObserved: OPENCODEX_GPT_PRIVATE_MAX_EDGE_OBSERVED,
      });
    } else {
      const aspectRatio = selected.aspectRatio;
      if (!OPENCODEX_NANO_ASPECT_RATIOS.includes(aspectRatio)) {
        throw new Error(`Nano Banana 2 不支持比例：${aspectRatio}`);
      }
      body.aspect_ratio = aspectRatio;
      body.image_size = selected.imageSize;
      requested.aspectRatio = aspectRatio;
      requested.imageSize = selected.imageSize;
      requested.sourceSize = size;
    }
    const url = normalizeApiUrl(endpoint, hasRef && refs.length ? "images/edits" : "images/generations");
    if (hasRef && refs.length) {
      body.images = refs.map(ref => ({ image_url: ref.dataUrl }));
    }
    try {
      const data = await apiFetch(url, OPENCODEX_PLACEHOLDER_KEY, body, {
        signal,
        nativeTimeoutMs: OPENCODEX_REQUEST_TIMEOUT_MS,
        forceDirectProxy: true,
      });
      const images = Array.isArray(data?.data) ? data.data : [];
      if (!images.some(item => item?.b64_json || item?.url)) {
        throw new Error("OpenCodex 上游没有返回图片，可能只返回了文本或被安全策略终止。");
      }
      data._openCodex = {
        provider: "opencodex-local-image",
        operation: hasRef && refs.length ? "edit" : "generation",
        requested,
        response: {
          quality: data?.quality || images[0]?.quality || null,
          size: data?.size || images[0]?.size || null,
          mimeType: images[0]?.mime_type || null,
        },
      };
      return data;
    } catch (err) {
      const message = String(err?.message || err || "");
      if (/HTTP\s*499\b/i.test(message)) throw createAbortError();
      const guidance = /HTTP\s*400\b/i.test(message)
        ? "请求参数不受支持，请检查模型、比例、分辨率、提示词或参考图。"
        : /HTTP\s*401\b/i.test(message)
          ? `${selectedModel === OPENCODEX_NANO_BANANA_2 ? "Google Antigravity" : "ChatGPT/Codex"} 授权已失效，请检查 ocx status 或重新登录。`
          : /HTTP\s*403\b/i.test(message)
            ? "当前上游账号策略或模型访问权限受限。"
          : /HTTP\s*409\b/i.test(message)
            ? "账号或任务状态已失效，请重新开始任务后再试。"
            : /HTTP\s*413\b/i.test(message)
              ? "参考图请求体过大，请减少图片数量或压缩图片。"
              : /HTTP\s*429\b/i.test(message)
                ? "上游正在限流或额度冷却，请稍后手动重试。"
                : /HTTP\s*502\b/i.test(message)
                  ? "OpenCodex 上游连接失败，任务不会自动重发，可稍后手动重试。"
                  : /HTTP\s*504\b/i.test(message)
                    ? "OpenCodex 上游生成超过 600 秒，任务不会自动重发，可稍后手动重试。"
                    : "";
      throw new Error(guidance ? `${guidance} ${message}` : message);
    }
  },
});

function pixelSizeToRatio(size) {
  const exact = {
    "1024x1024": "1:1", "1536x1024": "3:2", "1024x1536": "2:3",
    "1792x1024": "16:9", "1024x1792": "9:16", "512x512": "1:1", "256x256": "1:1",
  };
  if (exact[size]) return exact[size];
  const [w, h] = size.split("x").map(Number);
  if (!w || !h) return "1:1";
  const ratio = w / h;
  const candidates = OPENCODEX_NANO_ASPECT_RATIOS.map(label => {
    const [rw, rh] = label.split(":").map(Number);
    return { r: rw / rh, label };
  });
  candidates.sort((a, b) => Math.abs(a.r - ratio) - Math.abs(b.r - ratio));
  return candidates[0].label;
}

function parsePixelSize(size) {
  const match = String(size || "").toLowerCase().replace("×", "x").match(/^\s*(\d+)\s*x\s*(\d+)\s*$/);
  if (!match) return { width: 1024, height: 1024, maxSide: 1024, minSide: 1024 };
  const width = Number(match[1]) || 1024;
  const height = Number(match[2]) || 1024;
  return { width, height, maxSide: Math.max(width, height), minSide: Math.min(width, height) };
}

function grsaiEndpointBase(endpoint) {
  const raw = String(endpoint || GRSAI_API_ENDPOINT).trim() || GRSAI_API_ENDPOINT;
  try {
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1\/.*$/i, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/+$/, "").replace(/\/v1\/.*$/i, "").replace(/\/$/, "");
  }
}

function grsaiImageSize(size, model) {
  const normalizedModel = String(model || "").toLowerCase();
  if (/4k/.test(normalizedModel)) return "4K";
  if (/2k/.test(normalizedModel)) return "2K";
  const { maxSide } = parsePixelSize(size);
  if (maxSide >= 2048) return "4K";
  if (maxSide >= 1536) return "2K";
  return "1K";
}

function grsaiResultUrls(data) {
  const urls = [];
  const buckets = [data?.results, data?.data, data?.images].filter(Array.isArray);
  buckets.forEach(items => {
    items.forEach(item => {
      const url = typeof item === "string" ? item : (item?.url || item?.image_url);
      if (url && !urls.includes(url)) urls.push(url);
    });
  });
  if (typeof data?.url === "string" && !urls.includes(data.url)) urls.push(data.url);
  return urls;
}

function grsaiStatusError(data, fallback = "未知") {
  const value = data?.error || data?.message || data?.status || fallback;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); }
  catch { return String(value); }
}

function grsaiReferenceValue(ref) {
  const value = String(ref?.url || ref?.dataUrl || ref || "");
  if (/^data:/i.test(value)) return value.split(",")[1] || value;
  return value;
}

async function grsaiReadJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { return { error: text.slice(0, 300) }; }
}

// ═══════════════════════════════════════════════════════════
//  GrsAI 适配器
// ═══════════════════════════════════════════════════════════

registerAdapter({
  name: "GrsAI",
  provider: "grsai",
  detect(url) { return /grsai|dakka\.com\.cn|grsaiapi/.test(url); },
  sizeFormat: "pixel",
  supportsReference: true,
  concurrency: 10,

  fetchModels() {
    loadGrsaiModels();
  },

  async generate(endpoint, apiKey, model, prompt, size, n, hasRef, refs = [], options = {}) {
    const signal = options.signal;
    throwIfAborted(signal);
    const base = grsaiEndpointBase(endpoint);
    const isNano = /nano-banana/i.test(model);

    const body = {
      model, prompt, replyType: "json",
      aspectRatio: isNano ? pixelSizeToRatio(size) : size,
    };
    if (isNano) {
      body.imageSize = grsaiImageSize(size, model);
    }
    if (hasRef && refs.length > 0) {
      body.images = refs.map(grsaiReferenceValue).filter(Boolean);
    }
    console.log(`GrsAI 请求: model=${model} size=${size} hasRef=${hasRef} refs=${refs.length}`);

    const t0 = Date.now();
    let res;
    const submit504Policy = getGrsaiSubmit504RetryPolicy();
    let submit504Retries = 0;
    while (true) {
      throwIfAborted(signal);
      try {
        res = await apiFetch(`${base}/v1/api/generate`, apiKey, body, { signal, nativeTimeoutMs: null });
        break;
      } catch (err) {
        if (!/HTTP\s*504\b/i.test(String(err?.message || err || ""))) throw err;
        if (submit504Retries >= submit504Policy.maxRetries) {
          throw new Error(interpolate(cleanText("grsaiSubmit504Exhausted"), { count: submit504Retries }));
        }
        submit504Retries++;
        for (let remainingSeconds = submit504Policy.intervalSeconds; remainingSeconds > 0; remainingSeconds--) {
          options.onSubmit504Retry?.({
            retryIndex: submit504Retries,
            maxRetries: submit504Policy.maxRetries,
            intervalSeconds: submit504Policy.intervalSeconds,
            remainingSeconds,
            error: err,
          });
          await sleep(1000, signal);
        }
      }
    }
    let data = res;
    console.log(`GrsAI /api/generate 响应 (${Date.now() - t0}ms):`, data.status);

    const directUrls = grsaiResultUrls(data);
    if (directUrls.length > 0) {
      return { data: directUrls.map(url => ({ url })) };
    }

    if (data.status === "running") {
      const taskId = data.id;
      if (!taskId) throw new Error("GrsAI 未返回任务 ID");
      // 故意不设轮询次数上限——用户明确要求生图请求不设时长限制，让它想等多久就等多久。
      // 这个循环本身很轻量（每 2 秒一次的状态查询，不是持续占用一个大请求），唯一的退出方式
      // 是拿到终态（succeeded/failed/violation）或者用户主动点"停止生成"（signal 触发 abort，
      // sleep()/smartFetch() 都会据此抛出，从这里往外冒泡）。
      let gatewayTimeouts = 0;
      let nextPollDelay = GRSAI_POLL_INTERVAL_MS;
      while (true) {
        await sleep(nextPollDelay, signal);
        nextPollDelay = GRSAI_POLL_INTERVAL_MS;
        const pollResp = await smartFetch(`${base}/v1/api/result?id=${taskId}`, {
          headers: { "Authorization": `Bearer ${apiKey}` },
          signal,
        });
        res = await grsaiReadJsonResponse(pollResp);
        if (!pollResp.ok) {
          if (pollResp.status === 504) {
            gatewayTimeouts++;
            const delay = Math.min(
              GRSAI_POLL_GATEWAY_DELAY_MAX_MS,
              2000 * Math.pow(2, Math.min(gatewayTimeouts - 1, 4)),
            );
            showStatus(`GrsAI 查询暂时返回 HTTP 504，${Math.ceil(delay / 1000)} 秒后继续查询（第 ${gatewayTimeouts} 次）…`, "info");
            nextPollDelay = delay;
            continue;
          }
          throw new Error(`轮询失败 HTTP ${pollResp.status}: ${grsaiStatusError(res)}`);
        }
        gatewayTimeouts = 0;
        data = res;
        if (data.progress != null) showStatus(`GrsAI 生成中… ${data.progress}%`, "info");
        if (data.status === "succeeded") { clearStatus(); console.log(`GrsAI 完成 (${Date.now() - t0}ms)`); break; }
        if (data.status === "failed" || data.status === "violation") {
          throw new Error(`GrsAI 生成失败: ${grsaiStatusError(data)}`);
        }
      }
    }

    if (data.status === "violation") {
      throw new Error(`GrsAI 生成失败: ${grsaiStatusError(data, "内容违规")}`);
    }
    if (data.status === "succeeded") {
      const urls = grsaiResultUrls(data);
      if (urls.length) return { data: urls.map(url => ({ url })) };
      throw new Error("GrsAI 返回成功但无图片 URL");
    }
    throw new Error(`GrsAI 生成失败: ${grsaiStatusError(data)}`);
  },
});

// ═══════════════════════════════════════════════════════════
//  OpenAI 官方 Image API 适配器
// ═══════════════════════════════════════════════════════════

function validateOfficialImageSize(model, size) {
  const family = officialImageModelFamily(model);
  const normalizedSize = String(size || "").toLowerCase();
  if (normalizedSize === "auto") return;
  const match = normalizedSize.match(/^(\d+)x(\d+)$/);
  if (!match) {
    throw new Error(`OpenAI 图片尺寸无效：${size}。请选择预设尺寸，或输入“宽x高”（例如 2048x1152）。`);
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (family === "gpt-image-2") {
    const pixels = width * height;
    const ratio = Math.max(width, height) / Math.min(width, height);
    if (width > 3840 || height > 3840 || width % 16 !== 0 || height % 16 !== 0 || ratio > 3 || pixels < 655360 || pixels > 8294400) {
      throw new Error("OpenAI gpt-image-2 尺寸无效：边长需不超过 3840 且为 16 的倍数，长短边比不超过 3:1，总像素需在 655,360 到 8,294,400 之间。");
    }
    return;
  }
  if (!["1024x1024", "1024x1536", "1536x1024"].includes(normalizedSize)) {
    throw new Error(`${model} 仅支持 1024x1024、1024x1536 或 1536x1024；自定义尺寸请改用 gpt-image-2。`);
  }
}

function buildOfficialImageRequestOptions(model, size, hasRef) {
  validateOfficialImageSize(model, size);
  const selected = getOfficialImageOptions();
  const family = officialImageModelFamily(model);
  const options = {
    quality: selected.quality,
    background: family === "gpt-image-2" && selected.background === "transparent" ? "auto" : selected.background,
    output_format: selected.outputFormat,
    moderation: selected.moderation,
  };
  if (["jpeg", "webp"].includes(selected.outputFormat)) {
    options.output_compression = selected.outputCompression;
  }
  if (hasRef && family !== "gpt-image-2" && family !== "gpt-image-1-mini") {
    options.input_fidelity = selected.inputFidelity;
  }
  if (options.background === "transparent" && options.output_format === "jpeg") {
    options.output_format = "png";
    delete options.output_compression;
  }
  return options;
}

function decorateOfficialImageResponse(data, outputFormat, model = "", hasReference = false) {
  const mimeType = outputFormat === "jpeg" ? "image/jpeg" : outputFormat === "webp" ? "image/webp" : "image/png";
  if (Array.isArray(data?.data)) {
    data.data = data.data.map(item => item && typeof item === "object" ? { ...item, mime_type: item.mime_type || mimeType } : item);
  }
  if (data && typeof data === "object") {
    data._officialModel = model;
    data._officialHasReference = !!hasReference;
  }
  return data;
}

async function readOfficialApiError(response) {
  const text = await response.text().catch(() => "");
  try {
    const data = JSON.parse(text);
    return data?.error?.message || data?.message || text.slice(0, 300);
  } catch {
    return text.slice(0, 300) || `HTTP ${response.status}`;
  }
}

registerAdapter({
  name: "OpenAI Official",
  provider: "official",
  detect(url) { return /api\.openai\.com/.test(url); },
  sizeFormat: "pixel",
  supportsReference: true,
  concurrency: 5,

  async fetchModels(_endpoint, apiKey) {
    let response;
    try {
      response = await smartFetch("https://api.openai.com/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
        nativeTimeoutMs: 30000,
      });
    } catch (err) {
      loadOfficialModels();
      showStatus(interpolate(cleanText("officialModelsFallback"), { reason: err.message || err }), "error");
      return;
    }
    if (response.status === 401 || response.status === 403) {
      const reason = await readOfficialApiError(response);
      loadOfficialModels();
      showStatus(interpolate(cleanText("officialModelsFallback"), { reason: `${cleanText("officialModelAuthFailed")} · ${reason}` }), "error");
      return;
    }
    if (!response.ok) {
      const reason = await readOfficialApiError(response);
      loadOfficialModels();
      showStatus(interpolate(cleanText("officialModelsFallback"), { reason: `HTTP ${response.status} · ${reason}` }), "error");
      return;
    }
    const data = await response.json().catch(() => ({}));
    const ids = [...new Set((Array.isArray(data.data) ? data.data : [])
      .map(item => String(item?.id || ""))
      .filter(isOpenAiOfficialImageModelId))]
      .sort((a, b) => {
        const ai = OPENAI_OFFICIAL_IMAGE_MODELS.indexOf(a);
        const bi = OPENAI_OFFICIAL_IMAGE_MODELS.indexOf(b);
        return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.localeCompare(b);
      });
    if (!ids.length) {
      loadOfficialModels();
      showStatus(cleanText("officialModelsNoMatch"), "info");
      return;
    }
    const choices = loadOfficialModels(ids);
    showStatus(interpolate(cleanText("officialModelsDetected"), { count: choices.length }), "success");
  },

  async generate(endpoint, apiKey, model, prompt, size, n, hasRef, refs = [], options = {}) {
    const signal = options.signal;
    throwIfAborted(signal);
    const officialMask = options.officialMask || null;
    if (officialMask && officialImageModelFamily(model) !== "gpt-image-2") {
      throw new Error("原生蒙版局部重绘仅支持官方 OpenAI gpt-image-2。");
    }
    if (officialMask && (!hasRef || refs.length !== 1)) {
      throw new Error("原生蒙版局部重绘必须提供且只能提供一张原图。");
    }
    if (officialMask && !/^data:image\/png;base64,/i.test(String(officialMask.dataUrl || ""))) {
      throw new Error("OpenAI 局部重绘蒙版必须是带透明通道的 PNG。");
    }
    if (officialMask && (Number(officialMask.width) !== Number(refs[0]?.width) || Number(officialMask.height) !== Number(refs[0]?.height))) {
      throw new Error("OpenAI 局部重绘要求原图与蒙版尺寸完全一致。");
    }
    const officialOptions = buildOfficialImageRequestOptions(model, size, hasRef);
    if (!hasRef || refs.length === 0) {
      const url = normalizeApiUrl(endpoint, "images/generations");
      const data = await apiFetch(url, apiKey, { model, prompt, n, size, ...officialOptions }, { signal, nativeTimeoutMs: null });
      return decorateOfficialImageResponse(data, officialOptions.output_format, model, false);
    }

    const url = normalizeApiUrl(endpoint, "images/edits");
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("n", String(n));
    form.append("size", size);
    Object.entries(officialOptions).forEach(([key, value]) => form.append(key, String(value)));
    const referenceBlobs = refs.map(ref => dataUrlToBlob(ref.dataUrl));
    if (referenceBlobs.some(blob => blob.size >= 50 * 1024 * 1024)) {
      throw new Error("OpenAI 图片编辑要求每张原图小于 50 MB。");
    }
    referenceBlobs.forEach((blob, index) => {
      form.append("image[]", blob, refs[index].fileName || `reference-${index + 1}.png`);
    });
    if (officialMask) {
      const maskBlob = dataUrlToBlob(officialMask.dataUrl);
      if (referenceBlobs[0]?.type !== "image/png" || maskBlob.type !== "image/png") {
        throw new Error("OpenAI 局部重绘要求原图与蒙版使用相同的 PNG 格式。");
      }
      if (maskBlob.size >= 50 * 1024 * 1024) {
        throw new Error("OpenAI 图片编辑要求蒙版小于 50 MB。");
      }
      form.append("mask", maskBlob, officialMask.fileName || "mask.png");
    }
    const response = await smartFetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: form,
      signal,
      nativeTimeoutMs: null,
    });
    if (!response.ok) {
      const reason = await readOfficialApiError(response);
      throw new Error(`OpenAI 图片编辑失败 (HTTP ${response.status})：${reason}`);
    }
    return decorateOfficialImageResponse(await response.json(), officialOptions.output_format, model, true);
  },
});

// ═══════════════════════════════════════════════════════════
//  JeniyaTop 适配器（OpenAI 兼容协议）
// ═══════════════════════════════════════════════════════════

registerAdapter({
  name: "JeniyaTop",
  detect(url) { return /jeniya\.top/.test(url); },
  sizeFormat: "pixel",
  supportsReference: true,
  concurrency: 10,

  async fetchModels(endpoint, apiKey) {
    const baseUrl = endpoint.replace(/\/v1\/.*$/, "").replace(/\/$/, "");
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
      const resp = await smartFetch(baseUrl + "/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
        signal: ctrl.signal,
      });
      clearTimeout(t);

      if (!resp.ok) {
        loadFallbackModels();
        showStatus("模型列表获取失败，已加载常用模型", "info");
        return;
      }
      const data = await resp.json();
      let models = data.data || [];
      if (models.length === 0) { loadFallbackModels(); return; }
      const imgRe = /image|dall-e|diffusion|flux|banana|midjourney|imagen|sdxl|stable|nano/i;
      const imgModels = models.filter(m => imgRe.test(m.id));
      if (imgModels.length > 0) models = imgModels;

      setModelChoices(models.map(m => m.id));
      dom.model.value = "";
      dom.model.placeholder = `已加载 ${models.length} 个生图模型，点击选择`;
      showStatus(`已加载 ${models.length} 个生图模型`, "success");
    } catch {
      loadFallbackModels();
      showStatus("模型列表获取失败，已加载常用模型", "info");
    }
  },

  async generate(endpoint, apiKey, model, prompt, size, n, hasRef, refs = [], options = {}) {
    const signal = options.signal;
    throwIfAborted(signal);
    if (!hasRef || refs.length === 0) {
      const url = normalizeApiUrl(endpoint, "images/generations");
      console.log(`JeniyaTop → generations model=${model}`);
      return apiFetch(url, apiKey, { model, prompt, n, size, response_format: "b64_json" }, { signal, nativeTimeoutMs: null });
    }

    // 有参考图 → images/edits (multipart/form-data)
    const url = normalizeApiUrl(endpoint, "images/edits");
    const fd = new FormData();
    fd.append("model", model); fd.append("prompt", prompt);
    fd.append("n", String(n)); fd.append("size", size);
    fd.append("response_format", "b64_json");
    for (const ref of refs) {
      fd.append("image", dataUrlToBlob(ref.dataUrl), ref.fileName || "reference.png");
    }
    console.log(`JeniyaTop → edits model=${model} refs=${refs.length}`);

    const resp = await smartFetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: fd,
      signal,
      nativeTimeoutMs: null,
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`edits 端点不支持 (HTTP ${resp.status})。该模型可能不支持参考图编辑，请去掉参考图或换用其他模型。\n${t.slice(0, 300)}`);
    }
    return resp.json();
  },
});

// ═══════════════════════════════════════════════════════════
//  OpenAI 兼容适配器
// ═══════════════════════════════════════════════════════════

registerAdapter({
  name: "OpenAI 兼容",
  detect(url) { return true; },
  sizeFormat: "pixel",
  supportsReference: true,
  concurrency: 10,

  async fetchModels(endpoint, apiKey) {
    const baseUrl = endpoint.replace(/\/v1\/(images\/(generations|edits)|chat\/completions)\/?$/, "").replace(/\/$/, "");
    const candidates = [baseUrl + "/v1/models", baseUrl + "/models"];

    for (const modelsUrl of candidates) {
      try {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
        const resp = await smartFetch(modelsUrl, {
          headers: { "Authorization": `Bearer ${apiKey}` },
          signal: ctrl.signal,
        });
        clearTimeout(t);

        if (resp.status === 401 || resp.status === 403) {
          loadFallbackModels();
          showStatus("检测端点存在，但 API Key 无效或无权限。已加载常用模型供选择", "info");
          return;
        }
        if (!resp.ok) continue;

        const contentType = resp.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) continue;

        const data = await resp.json();
        let models = data.data || [];
        if (models.length === 0) continue;

        const imgRe = /image|dall-e|diffusion|flux|banana|midjourney|imagen|sdxl|stable|nano/i;
        const imgModels = models.filter(m => imgRe.test(m.id));
        if (imgModels.length > 0) models = imgModels;

        setModelChoices(models.map(m => m.id));
        dom.model.value = "";
        dom.model.placeholder = `已加载 ${models.length} 个生图模型，点击选择`;
        showStatus(`已加载 ${models.length} 个生图模型`, "success");
        return;
      } catch { continue; }
    }

    loadFallbackModels();
    showStatus("该 API 不开放模型列表，已加载常用模型", "info");
  },

  async generate(endpoint, apiKey, model, prompt, size, n, hasRef, refs = [], options = {}) {
    const signal = options.signal;
    throwIfAborted(signal);
    if (!hasRef || refs.length === 0) {
      const url = normalizeApiUrl(endpoint, "images/generations");
      console.log(`OpenAI → generations model=${model}`);
      return apiFetch(url, apiKey, { model, prompt, n, size, response_format: "b64_json" }, { signal, nativeTimeoutMs: null });
    }

    const url = normalizeApiUrl(endpoint, "images/edits");
    const fd = new FormData();
    fd.append("model", model); fd.append("prompt", prompt);
    fd.append("n", String(n)); fd.append("size", size);
    fd.append("response_format", "b64_json");
    for (const ref of refs) {
      fd.append("image", dataUrlToBlob(ref.dataUrl), ref.fileName || "reference.png");
    }
    console.log(`OpenAI → edits model=${model} refs=${refs.length}`);

    const resp = await smartFetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: fd,
      signal,
      nativeTimeoutMs: null,
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      throw new Error(`edits 端点不支持 (HTTP ${resp.status})。该模型可能不支持参考图编辑，请去掉参考图或换用其他模型。\n${t.slice(0, 300)}`);
    }
    return resp.json();
  },
});

// ═══════════════════════════════════════════════════════════
//  API 调用核心（适配器路由）
// ═══════════════════════════════════════════════════════════

async function callImageAPI(prompt, size, n = 1, contextLabel = "图片", options = {}) {
  const signal = options.signal || null;
  const requestedMaxRetries = clampRetryCount(options.maxRetries, getGlobalRetryCount());
  throwIfAborted(signal);
  const endpoint = dom.apiEndpoint.value.trim();
  const apiKey   = dom.apiKey.value.trim();
  const model    = dom.model.value.trim() || "gpt-image-2";
  const refs     = Array.isArray(options.references) ? dedupeReferences(options.references) : referenceImages;
  const hasRef   = refs.length > 0;
  const provider = dom.apiProvider?.value || inferApiProvider(endpoint);
  const maxRetries = provider === "opencodex" ? 0 : requestedMaxRetries;
  const adapter  = findAdapter(endpoint, provider);

  console.log(`callImageAPI: provider=${provider} adapter=${adapter?.name || "无(直连)"} model=${model} hasRef=${hasRef} refs=${refs.length} size=${size}`);

  let finalSize = size;
  if (!options.preserveRequestedSize && dom.useOrigSize.checked && hasRef) {
    const ref = refs[0];
    if (ref.width && ref.height) finalSize = `${ref.width}x${ref.height}`;
  }

  return retryTransient(async attempt => {
    throwIfAborted(signal);
    if (!adapter) {
      const url = normalizeApiUrl(endpoint, "images/generations");
      if (hasRef) console.warn("⚠ 无适配器匹配 + 有参考图：参考图将被忽略，仅走 generations 端点");
      return apiFetch(url, apiKey, { model, prompt, n, size: finalSize, response_format: "b64_json" }, { signal, nativeTimeoutMs: null });
    }
    return adapter.generate(endpoint, apiKey, model, prompt, finalSize, n, hasRef, refs, {
      signal,
      openCodexOptions: options.openCodexOptions,
      officialMask: options.officialMask,
      onSubmit504Retry: ({ retryIndex, maxRetries, intervalSeconds, remainingSeconds }) => {
        showStatus(interpolate(cleanText("grsaiSubmit504Waiting"), {
          seconds: remainingSeconds,
          retryIndex,
          maxRetries,
        }), "info");
        if (remainingSeconds === intervalSeconds) {
          options.onRetryAttempt?.({ retryIndex, maxRetries, statusLabel: "HTTP 504" });
        }
      },
    });
  }, {
    signal,
    maxRetries,
    onRetry: ({ retryIndex, maxRetries, error }) => {
      const statusMatch = String(error?.message || "").match(/HTTP\s*(\d{3})/i);
      const statusLabel = statusMatch ? `HTTP ${statusMatch[1]}` : "临时错误";
      showStatus(`${contextLabel} 返回 ${statusLabel}，正在进行第 ${retryIndex}/${maxRetries} 轮自动重试…`, "info");
      options.onRetryAttempt?.({ retryIndex, maxRetries, statusLabel });
    },
  });
}

function isTransientApiError(err) {
  const msg = String(err?.message || err || "");
  // 产品规则是精确的：只有供应商返回 HTTP 400 才自动重试。任何成功图片都会直接 return，
  // 其它状态码和网络错误立即交给用户处理，避免把不可恢复的失败重复提交多轮。
  return /HTTP\s*400\b/i.test(msg);
}

async function retryTransient(fn, options = {}) {
  const maxRetries = clampRetryCount(options.maxRetries, 3);
  const baseDelay = options.baseDelay ?? 1500;
  const signal = options.signal || null;
  const onRetry = typeof options.onRetry === "function" ? options.onRetry : null;
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    throwIfAborted(signal);
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (err?.name === "AbortError") throw err;
      if (attempt > maxRetries || !isTransientApiError(err)) throw err;
      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 600);
      onRetry?.({ retryIndex: attempt, maxRetries, nextAttempt: attempt + 1, delay, error: err });
      console.warn(`Transient API error, retry round ${attempt}/${maxRetries} after ${delay}ms:`, err);
      await sleep(delay, signal);
    }
  }
  throw lastErr;
}

async function detectModelsForAdapter() {
  const endpoint = dom.apiEndpoint.value.trim();
  const apiKey   = dom.apiKey.value.trim();
  if (!endpoint || !apiKey) {
    showStatus("请先填写 API 地址和 Key", "error");
    keepApiConfigVisible();
    return;
  }

  const provider = dom.apiProvider?.value || inferApiProvider(endpoint);
  const adapter = findAdapter(endpoint, provider);
  if (!adapter) {
    loadFallbackModels();
    showStatus("未知平台，已加载通用模型列表", "info");
    return;
  }

  dom.detectModels.disabled = true;
  setIconText(dom.detectModels, "spark", currentLanguage === "en" ? "Detecting" : currentLanguage === "ja" ? "検出中" : currentLanguage === "ko" ? "감지 중" : currentLanguage === "zh-Hant" ? "偵測中" : "检测中");
  showStatus("正在检测模型列表…", "info");

  try {
    if (adapter.fetchModels) {
      await adapter.fetchModels(endpoint, apiKey);
    } else {
      loadFallbackModels();
      showStatus("该平台不支持模型列表查询，已加载常用模型", "info");
    }
    dom.model.focus();
  } catch (err) {
    loadFallbackModels();
    showStatus(`模型检测失败，已加载常用模型：${err.message || err}`, "error");
  } finally {
    dom.detectModels.disabled = false;
    setButtonText(dom.detectModels, "search", "detect");
  }
}

function createAbortError() {
  try { return new DOMException("生成已取消", "AbortError"); }
  catch {
    const err = new Error("生成已取消");
    err.name = "AbortError";
    return err;
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

// 合并两个 AbortSignal：批量生成整体的 signal（用户点"停止生成"）+ 单张卡片自己的
// signal（用户点这张卡片自己的"停止重试"按钮）。没有用 AbortSignal.any()（更新的浏览器
// 才有）是为了不给这个已经支持打包成较旧 WebView2/PWA 场景的项目引入兼容性风险。
function combineSignals(signalA, signalB) {
  if (!signalA) return signalB || null;
  if (!signalB) return signalA;
  const controller = new AbortController();
  if (signalA.aborted || signalB.aborted) {
    controller.abort();
  } else {
    const onAbort = () => controller.abort();
    signalA.addEventListener("abort", onAbort, { once: true });
    signalB.addEventListener("abort", onAbort, { once: true });
  }
  return controller.signal;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(createAbortError());
    }, { once: true });
  });
}

// ─── 并发控制 ──────────────────────────────────────────────

function getProviderConcurrency() {
  const endpoint = dom.apiEndpoint?.value?.trim?.() || "";
  const provider = dom.apiProvider?.value || inferApiProvider(endpoint);
  const adapter = findAdapter(endpoint, provider);
  const configured = Number(typeof adapter?.getConcurrency === "function"
    ? adapter.getConcurrency()
    : adapter?.concurrency || 4);
  return Math.max(1, Math.min(20, Number.isFinite(configured) ? Math.floor(configured) : 4));
}

async function concurrentLimitSettled(tasks, limit = 20, signal = null) {
  const results = [];
  const executing = [];
  for (const task of tasks) {
    if (signal?.aborted) break;
    const p = task()
      .then(r => ({ status: "fulfilled", value: r }))
      .catch(e => ({ status: "rejected", reason: e?.message || String(e) }));
    results.push(p);
    const tracker = p.then(r => { executing.splice(executing.indexOf(tracker), 1); return r; });
    executing.push(tracker);
    if (executing.length >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

async function concurrentLimit(tasks, limit = 20) {
  const results = [];
  const executing = [];
  for (const task of tasks) {
    const tracker = task()
      .then(r => { executing.splice(executing.indexOf(tracker), 1); return r; })
      .catch(e => { executing.splice(executing.indexOf(tracker), 1); throw e; });
    results.push(tracker);
    executing.push(tracker);
    if (executing.length >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

function normalizeApiUrl(inputUrl, path) {
  let url = inputUrl.trim().replace(/\/+$/, "");
  if (/\/v1\//.test(url)) {
    const base = url.replace(/\/v1\/(images\/(generations|edits)|chat\/completions|models)\/?$/, "");
    return base + "/v1/" + path;
  }
  if (!url.endsWith("/v1")) url += "/v1";
  return url + "/" + path;
}

function headersToObject(headers = {}) {
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return { ...headers };
}

async function formDataToProxyFields(formData, signal = null) {
  const fields = [];
  for (const [name, value] of formData.entries()) {
    throwIfAborted(signal);
    if (value instanceof Blob) {
      fields.push({
        name,
        type: "blob",
        filename: value.name || "upload.bin",
        mimeType: value.type || "application/octet-stream",
        base64: await blobToBase64(value),
      });
    } else {
      fields.push({ name, type: "text", value: String(value) });
    }
  }
  return fields;
}

async function createProxyPayload(url, method, headers, body, signal = null, options = {}) {
  const desktopProxy = options.forceDirectProxy
    ? { proxyMode: "direct", proxyUrl: "" }
    : getDesktopProxyPayload({ validate: false });
  if (body instanceof FormData) {
    return {
      url,
      method,
      headers,
      bodyType: "formData",
      fields: await formDataToProxyFields(body, signal),
      ...desktopProxy,
    };
  }
  return { url, method, headers, body: body || "", ...desktopProxy };
}

async function smartFetch(url, options = {}) {
  const signal = options.signal || null;
  throwIfAborted(signal);
  const hasExplicitTimeout = Object.prototype.hasOwnProperty.call(options, "nativeTimeoutMs");
  const requestTimeoutMs = hasExplicitTimeout ? options.nativeTimeoutMs : 120000;
  const forceDirectProxy = options.forceDirectProxy === true;
  const useNative = nativeDownload.available() && /^https?:\/\//i.test(url);
  const fetchOptions = { ...options };
  delete fetchOptions.nativeTimeoutMs;
  delete fetchOptions.forceDirectProxy;
  let browserTimer = null;
  let browserAbort = null;
  let forwardAbort = null;
  let browserTimedOut = false;
  let effectiveSignal = signal;
  if (!useNative && requestTimeoutMs !== null && Number.isFinite(Number(requestTimeoutMs)) && Number(requestTimeoutMs) > 0) {
    browserAbort = new AbortController();
    if (signal) {
      forwardAbort = () => browserAbort.abort();
      signal.addEventListener("abort", forwardAbort, { once: true });
    }
    browserTimer = setTimeout(() => {
      browserTimedOut = true;
      browserAbort.abort();
    }, Number(requestTimeoutMs));
    effectiveSignal = browserAbort.signal;
  }
  const method = options.method || "GET";
  const headers = headersToObject(options.headers || {});
  const body = options.body instanceof FormData
    ? options.body
    : (typeof options.body === "string" || options.body == null ? options.body : JSON.stringify(options.body));

  try {
    if (useNative) {
      const payload = await createProxyPayload(url, method, headers, body, signal, { forceDirectProxy });
      // 生图调用显式传 null，可无限等待但仍能由 signal 手动取消；更新检查、模型检测、
      // 图片加载等普通请求使用默认 120 秒上限，避免界面永久卡在“处理中”。
      const result = await nativeDownload.nativeFetchPayload(payload, requestTimeoutMs, signal);
      throwIfAborted(signal);
      return new Response(result.body || "", {
        status: result.status || 200,
        headers: result.headers || {},
      });
    }

    const proxy = dom.proxyEndpoint?.value.trim();
    if (!forceDirectProxy && proxy && /^https?:\/\//i.test(url)) {
      const payload = await createProxyPayload(url, method, headers, body, effectiveSignal);
      throwIfAborted(effectiveSignal);
      return await fetch(proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: effectiveSignal,
      });
    }

    return await fetch(url, { ...fetchOptions, signal: effectiveSignal });
  } catch (err) {
    if (browserTimedOut) throw new Error(`网络请求超时（${Math.round(Number(requestTimeoutMs) / 1000)} 秒）`);
    throw err;
  } finally {
    if (browserTimer !== null) clearTimeout(browserTimer);
    if (forwardAbort && signal) signal.removeEventListener("abort", forwardAbort);
  }
}

async function apiFetch(url, apiKey, body, options = {}) {
  let response;
  try {
    response = await smartFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal || null,
      nativeTimeoutMs: Object.prototype.hasOwnProperty.call(options, "nativeTimeoutMs") ? options.nativeTimeoutMs : 120000,
      forceDirectProxy: options.forceDirectProxy === true,
    });
  } catch (err) {
    if (err.message === "Failed to fetch") {
      console.error("请求 URL:", url);
      throw new Error("网络请求失败。桌面软件请检查设置里的电脑端网络代理；纯浏览器 HTML 请运行 api-proxy.js，并填写启动时显示的完整带令牌地址");
    }
    throw err;
  }

  if (!response.ok) {
    const errorText = await response.text();
    let jsonSummary = "";
    try {
      const payload = JSON.parse(errorText);
      const apiError = payload?.error && typeof payload.error === "object" ? payload.error : payload;
      const message = apiError?.message || apiError?.error || payload?.message || "";
      const code = apiError?.code || payload?.code || "";
      if (message) jsonSummary = `${code ? `[${code}] ` : ""}${typeof message === "string" ? message : JSON.stringify(message)}`;
    } catch {}
    const titleMatch = errorText.match(/<title[^>]*>([^<]*)<\/title>/i);
    const headingMatch = errorText.match(/<h1[^>]*>([^<]*)<\/h1>/i);
    const plainText = errorText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const summary = (jsonSummary || titleMatch?.[1] || headingMatch?.[1] || plainText || response.statusText || "请求失败").trim();
    throw new Error(`HTTP ${response.status}: ${summary.slice(0, 300)}`);
  }

  const ct = response.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await response.text();
    const titleMatch = text.match(/<title>([^<]*)<\/title>/i);
    const hint = titleMatch ? `（页面标题: ${titleMatch[1]}）` : "";
    throw new Error(`服务器返回了网页而非 API 数据${hint}。请检查 API 地址是否正确`);
  }

  return response.json();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════════════════
//  校验
// ═══════════════════════════════════════════════════════════

function validateCommon() {
  const endpoint = dom.apiEndpoint.value.trim();
  const apiKey   = dom.apiKey.value.trim();
  if (!endpoint) { showStatus("请先配置 API 地址", "error"); keepApiConfigVisible(); return false; }
  if (!apiKey)   { showStatus("请先配置 API Key", "error"); keepApiConfigVisible(); return false; }
  return true;
}

async function validateProviderReady() {
  if (!isOpenCodexSelected()) return true;
  return checkOpenCodexHealth({ announce: true, force: false });
}

// ═══════════════════════════════════════════════════════════
//  单图模式生成
// ═══════════════════════════════════════════════════════════

async function generateSingle() {
  if (!validateCommon()) return;

  const prompt  = getEffectivePrompt();
  const size    = getSelectedSize();
  const n       = parseInt(dom.nImages.value) || 1;
  const references = dedupeReferences(referenceImages);
  const retryCount = getGlobalRetryCount();

  if (!prompt) { showStatus("请输入提示词或导入 txt 文件", "error"); dom.prompt.focus(); return; }
  if (!(await validateProviderReady())) return;

  const run = beginGeneration();
  clearStatus();

  try {
    dom.resultGrid.innerHTML = "";
    dom.resultGrid.classList.remove("hidden");
    dom.resultToolbar.classList.remove("hidden");
    dom.emptyState.classList.add("hidden");
    updateFailedRetryTools();
    let ok = 0, fail = 0;

    const tasks = Array.from({ length: n }, (_, i) => async () => {
      if (!isGenerationCurrent(run)) return;
      const placeholder = addResultPlaceholder(i + 1, prompt, {
        mode: "single",
        prompt,
        size,
        references,
        retryCount,
      });
      const cardAbort = new AbortController();
      placeholder._cardRetryAbortController = cardAbort;
      try {
        const data = await callImageAPI(prompt, size, 1, `图片 ${i + 1}`, {
          references, signal: combineSignals(run.signal, cardAbort.signal), maxRetries: retryCount,
          onRetryAttempt: info => updateCardRetryAttempt(placeholder, info),
        });
        if (!isGenerationCurrent(run)) return;
        const record = replacePlaceholder(placeholder, i + 1, data, prompt, {
          retryContext: { mode: "single", prompt, size, references, retryCount },
        });
        if (record) placeholder._historyRecordId = record.id;
        ok++;
      } catch (err) {
        if (err?.name === "AbortError") {
          markPlaceholderFailed(placeholder, i + 1, cardAbort.signal.aborted ? "已手动取消" : "已取消生成", { mode: "single", prompt, size, references, retryCount });
          fail++;
          return;
        }
        if (!isGenerationCurrent(run)) return;
        markPlaceholderFailed(placeholder, i + 1, err.message, { mode: "single", prompt, size, references, retryCount });
        fail++;
      }
    });

    if (dom.sequentialMode.checked) {
      for (const task of tasks) {
        if (!isGenerationCurrent(run)) break;
        await task();
      }
    } else {
      await concurrentLimitSettled(tasks, getProviderConcurrency(), run.signal);
    }

    if (!isGenerationCurrent(run)) return;
    if (ok === 0) throw new Error(`全部 ${n} 张生成失败`);
    if (fail > 0) showStatus(`${ok} 张成功，${fail} 张失败`, "error");
    else showStatus(`${ok} 张全部生成完成`, "success");

  } catch (err) {
    if (err?.name === "AbortError" || !isGenerationCurrent(run)) return;
    hideLoading();
    let msg = err.message;
    if (msg === "Failed to fetch") {
      msg = "网络请求失败。手机端会使用原生网络；纯浏览器端请运行 api-proxy.js，并填写启动时显示的完整带令牌地址";
    }
    showStatus(`生成失败: ${msg}`, "error");
    dom.emptyState.classList.remove("hidden");
  } finally {
    if (isGenerationCurrent(run)) {
      abortController = null;
      resetGenerateButton();
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  漫画分镜批量生成
// ═══════════════════════════════════════════════════════════

async function generateComic() {
  if (!validateCommon()) return;

  const globalPrompt = getEffectivePrompt();
  const globalSize   = getSelectedSize();
  let panels         = collectPanels();
  await waitForPanelReferenceTasks(panels);
  panels             = collectPanels();

  const validPanels = panels.filter(p => p.prompt);
  if (validPanels.length === 0) {
    showStatus("请至少为一个分镜填写提示词", "error"); return;
  }
  if (!(await validateProviderReady())) return;

  const run = beginGeneration();
  clearStatus();
  dom.resultGrid.innerHTML = "";
  dom.resultGrid.classList.remove("hidden");
  dom.resultToolbar.classList.remove("hidden");
  dom.emptyState.classList.add("hidden");
  updateFailedRetryTools();
  hideLoading();
  generatedImageUrls = [];
  dom.progressWrap.classList.remove("hidden");

  const total = validPanels.length;
  let completed = 0;
  let failed = 0;
  const globalRetryCount = getGlobalRetryCount();
  const projectImages = [];

  updateProgress(0, total, "⏳");

  const panelTasks = validPanels.map(panel => {
    const fullPrompt = globalPrompt ? `${globalPrompt}\n\n${panel.prompt}` : panel.prompt;
    const size = panel.size || globalSize;
    const references = getPanelRequestReferences(panel);
    const retryCount = panel.retryCount ?? globalRetryCount;
    const placeholder = addResultPlaceholder(panel.id, fullPrompt, {
      mode: "comic",
      globalPrompt,
      panelPrompt: panel.prompt,
      prompt: fullPrompt,
      size,
      references,
      retryCount,
    });
    return { panel, fullPrompt, size, references, retryCount, placeholder, globalPrompt };
  });

  let done = 0;
  const tasks = panelTasks.map(({ panel, fullPrompt, size, references, retryCount, placeholder }) => async () => {
    if (!isGenerationCurrent(run)) return;
    const cardAbort = new AbortController();
    placeholder._cardRetryAbortController = cardAbort;
    try {
      const data = await callImageAPI(fullPrompt, size, 1, `分镜 ${panel.id}`, {
        references, signal: combineSignals(run.signal, cardAbort.signal), maxRetries: retryCount,
        onRetryAttempt: info => updateCardRetryAttempt(placeholder, info),
      });
      if (!isGenerationCurrent(run)) return;
      const record = replacePlaceholder(placeholder, panel.id, data, fullPrompt, {
        skipHistory: true,
        recordPrompt: panel.prompt,
        fullPrompt,
        size,
        retryContext: { references, size, mode: "comic", globalPrompt, panelPrompt: panel.prompt, prompt: fullPrompt, fullPrompt, retryCount },
      });
      if (record) projectImages.push({
        ...record,
        prompt: panel.prompt,
        panelPrompt: panel.prompt,
        fullPrompt,
        retryCount,
        _cachePromise: placeholder._imageCachePromise,
      });
      completed++;
    } catch (err) {
      const isAbort = err.name === "AbortError";
      if (isAbort || isGenerationCurrent(run)) {
        const message = isAbort ? (cardAbort.signal.aborted ? "已手动取消" : "已取消生成") : err.message;
        markPlaceholderFailed(placeholder, panel.id, message, {
          references,
          size,
          mode: "comic",
          globalPrompt,
          panelPrompt: panel.prompt,
          prompt: fullPrompt,
          fullPrompt,
          retryCount,
        });
        failed++;
      }
    }
    if (!isGenerationCurrent(run)) return;
    done++;
    updateProgress(done, total, done >= total ? "✅" : "⏳");
  });

  try {
    if (dom.sequentialMode.checked) {
      for (const task of tasks) {
        if (!isGenerationCurrent(run)) break;
        await task();
      }
    } else {
      await concurrentLimitSettled(tasks, getProviderConcurrency(), run.signal);
    }

    if (!isGenerationCurrent(run)) return;
    updateProgress(completed + failed, total, "✅");

    if (completed > 0 || failed > 0) {
      const newProjectId = `project_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      await saveGenerationProject({
        id: newProjectId,
        type: "comic-project",
        mode: "comic",
        title: `${cleanText("comicProject")} ${new Date().toLocaleString(localeTagForCurrentLanguage())}`,
        createdAt: new Date().toISOString(),
        globalPrompt,
        model: dom.model.value.trim(),
        endpoint: dom.apiEndpoint.value.trim(),
        size: globalSize,
        retryCount: globalRetryCount,
        totalPanels: total,
        panels: panelTasks.map(({ panel, size, retryCount }) => ({
          panelId: String(panel.id),
          panelPrompt: panel.prompt,
          prompt: panel.prompt,
          size,
          retryCount,
          // 历史项目只恢复参数，不保存或恢复参考图，避免把大体积 data URL 塞进 localStorage。
          references: [],
          status: projectImages.some(img => String(img.panelId) === String(panel.id)) ? "success" : "failed",
        })),
        images: projectImages.sort((a, b) => Number(a.panelId) - Number(b.panelId)),
      });
      currentComicHistoryId = newProjectId;
    }

    if (failed > 0) {
      showStatus(`完成：${completed} 成功 / ${failed} 失败`, "error");
    } else if (completed > 0) {
      showStatus(`全部 ${completed} 个分镜生成完成！`, "success");
    }
  } catch (err) {
    if (err?.name !== "AbortError" && isGenerationCurrent(run)) {
      showStatus(`批量生成失败: ${err.message || err}`, "error");
    }
  } finally {
    if (isGenerationCurrent(run)) {
      abortController = null;
      resetGenerateButton();
      setTimeout(() => {
        if (activeGenerationId === run.id) dom.progressWrap.classList.add("hidden");
      }, 3000);
    }
  }
}

async function generateCaptions() {
  if (!validateCommon()) return;

  const globalPrompt = getEffectivePrompt();
  const globalSize   = getSelectedSize();
  let rows           = collectCaptionRows();
  await waitForCaptionReferenceTasks(rows);
  rows               = collectCaptionRows();

  const validRows = rows.filter(r => r.captionText && r.reference);
  if (validRows.length === 0) {
    showStatus("请至少给一张图片上传图片并填写气泡文字", "error"); return;
  }
  if (!(await validateProviderReady())) return;

  const run = beginGeneration();
  clearStatus();
  dom.resultGrid.innerHTML = "";
  dom.resultGrid.classList.remove("hidden");
  dom.resultToolbar.classList.remove("hidden");
  dom.emptyState.classList.add("hidden");
  updateFailedRetryTools();
  hideLoading();
  generatedImageUrls = [];
  dom.progressWrap.classList.remove("hidden");

  const total = validRows.length;
  let completed = 0;
  let failed = 0;
  const globalRetryCount = getGlobalRetryCount();
  const projectImages = [];

  updateProgress(0, total, "⏳");

  const rowTasks = validRows.map(row => {
    const fullPrompt = globalPrompt ? `${globalPrompt}\n\n${row.captionText}` : row.captionText;
    const size = (row.reference?.width && row.reference?.height) ? `${row.reference.width}x${row.reference.height}` : globalSize;
    const references = [row.reference];
    const retryCount = globalRetryCount;
    const placeholder = addResultPlaceholder(row.id, fullPrompt, {
      mode: "caption",
      globalPrompt,
      panelPrompt: row.captionText,
      prompt: fullPrompt,
      size,
      references,
      retryCount,
    });
    return { row, fullPrompt, size, references, retryCount, placeholder, globalPrompt };
  });

  let done = 0;
  const tasks = rowTasks.map(({ row, fullPrompt, size, references, retryCount, placeholder }) => async () => {
    if (!isGenerationCurrent(run)) return;
    const cardAbort = new AbortController();
    placeholder._cardRetryAbortController = cardAbort;
    try {
      const data = await callImageAPI(fullPrompt, size, 1, `图片 ${row.id}`, {
        references, signal: combineSignals(run.signal, cardAbort.signal), maxRetries: retryCount,
        onRetryAttempt: info => updateCardRetryAttempt(placeholder, info),
      });
      if (!isGenerationCurrent(run)) return;
      const record = replacePlaceholder(placeholder, row.id, data, fullPrompt, {
        skipHistory: true,
        recordPrompt: row.captionText,
        fullPrompt,
        size,
        retryContext: { references, size, mode: "caption", globalPrompt, panelPrompt: row.captionText, prompt: fullPrompt, fullPrompt, retryCount },
      });
      if (record) projectImages.push({
        ...record,
        prompt: row.captionText,
        panelPrompt: row.captionText,
        fullPrompt,
        retryCount,
        _cachePromise: placeholder._imageCachePromise,
      });
      completed++;
    } catch (err) {
      const isAbort = err.name === "AbortError";
      if (isAbort || isGenerationCurrent(run)) {
        const message = isAbort ? (cardAbort.signal.aborted ? "已手动取消" : "已取消生成") : err.message;
        markPlaceholderFailed(placeholder, row.id, message, {
          references,
          size,
          mode: "caption",
          globalPrompt,
          panelPrompt: row.captionText,
          prompt: fullPrompt,
          fullPrompt,
          retryCount,
        });
        failed++;
      }
    }
    if (!isGenerationCurrent(run)) return;
    done++;
    updateProgress(done, total, done >= total ? "✅" : "⏳");
  });

  try {
    if (dom.sequentialMode.checked) {
      for (const task of tasks) {
        if (!isGenerationCurrent(run)) break;
        await task();
      }
    } else {
      await concurrentLimitSettled(tasks, getProviderConcurrency(), run.signal);
    }

    if (!isGenerationCurrent(run)) return;
    updateProgress(completed + failed, total, "✅");

    if (completed > 0 || failed > 0) {
      const newProjectId = `project_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      await saveGenerationProject({
        id: newProjectId,
        type: "caption-project",
        mode: "caption",
        title: `${cleanText("captionProject")} ${new Date().toLocaleString(localeTagForCurrentLanguage())}`,
        createdAt: new Date().toISOString(),
        globalPrompt,
        model: dom.model.value.trim(),
        endpoint: dom.apiEndpoint.value.trim(),
        size: globalSize,
        retryCount: globalRetryCount,
        totalPanels: total,
        panels: rowTasks.map(({ row, size, retryCount }) => ({
          panelId: String(row.id),
          panelPrompt: row.captionText,
          prompt: row.captionText,
          size,
          retryCount,
          references: [],
          status: projectImages.some(img => String(img.panelId) === String(row.id)) ? "success" : "failed",
        })),
        images: projectImages.sort((a, b) => Number(a.panelId) - Number(b.panelId)),
      });
      currentComicHistoryId = newProjectId;
    }

    if (failed > 0) {
      showStatus(`完成：${completed} 成功 / ${failed} 失败`, "error");
    } else if (completed > 0) {
      showStatus(`全部 ${completed} 张图片生成完成！`, "success");
    }
  } catch (err) {
    if (err?.name !== "AbortError" && isGenerationCurrent(run)) {
      showStatus(`批量生成失败: ${err.message || err}`, "error");
    }
  } finally {
    if (isGenerationCurrent(run)) {
      abortController = null;
      resetGenerateButton();
      setTimeout(() => {
        if (activeGenerationId === run.id) dom.progressWrap.classList.add("hidden");
      }, 3000);
    }
  }
}

function updateProgress(done, total, icon) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  dom.progressFill.style.width = `${pct}%`;
  dom.progressText.textContent = `${icon} ${done}/${total}`;
  dom.progressWrap?.setAttribute("aria-valuenow", String(pct));
  dom.progressWrap?.setAttribute("aria-valuetext", `${done}/${total}`);
}

// ─── 结果卡片 / 人工重试 ─────────────────────────────────────

// 每张卡片从一进入 loading 状态开始就有一个"取消"按钮（不只是撞上自动重试之后才出现）——
// 用户明确要求"单张图片能取消生成"，这个按钮在首次生成和自动重试期间都可以点，点击效果
// 都是 abort 这张卡片自己的 AbortController。重建 innerHTML 会连带丢弃旧的事件监听器，
// 所以每次重建卡片（初始占位、人工重试的 renderRetryLoading）都要重新调用这个函数绑定一次。
function wireCardStopRetryButton(card) {
  const btn = card.querySelector(".stop-card-retry");
  btn?.addEventListener("click", () => {
    card._cardRetryAbortController?.abort();
  });
}

// callImageAPI() 的 onRetryAttempt 回调调用这个函数，把"第几次自动重试"显示到具体这一张
// 卡片上（而不只是顶部会被其它卡片覆盖掉的全局状态栏）。"取消"按钮本身从卡片一创建就是
// 可见的（见 addResultPlaceholder()/renderRetryLoading()），这里对它的 classList.remove
// 只是防御性的（万一以后有路径创建卡片时漏加可见状态），不是"只有重试时才露出来"。
function updateCardRetryAttempt(card, { retryIndex, maxRetries, statusLabel } = {}) {
  if (!card?.isConnected) return;
  const label = card.querySelector(".retry-attempt-label");
  if (label) {
    const source = `第 ${retryIndex}/${maxRetries} 次自动重试${statusLabel ? `（${statusLabel}）` : ""}`;
    label.textContent = translateTextValue(source);
    label.classList.remove("hidden");
  }
  card.querySelector(".stop-card-retry")?.classList.remove("hidden");
}

function addResultPlaceholder(panelId, prompt, retryContext = {}) {
  const card = document.createElement("div");
  card.className = "result-item";
  card.dataset.panelId = panelId;
  card.dataset.status = "loading";
  setRetryContext(card, panelId, {
    prompt,
    size: getSelectedSize(),
    mode: currentMode,
    ...retryContext,
  });
  card.innerHTML = `
    <div class="panel-label">${escapeHtml(tr(`分镜 ${panelId}`))}</div>
    <div class="result-media result-media-loading">
      <div class="spinner" style="width:28px;height:28px;"></div>
      <div class="retry-attempt-label hidden"></div>
      <button type="button" class="btn btn-xs stop-card-retry" title="${escapeHtml(cleanText("stopCardRetry"))}"><span class="ui-icon ui-icon-x"></span></button>
    </div>
    <div class="result-actions">
      <span style="font-size:0.75rem;color:var(--text2);padding:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;" title="${escapeHtml(prompt)}">${escapeHtml(prompt.slice(0, 60))}…</span>
    </div>`;
  wireCardStopRetryButton(card);
  dom.resultGrid.appendChild(card);
  return card;
}

function makeCardActionBtn(iconName, key, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-sm card-action";
  btn.title = cleanText(key);
  btn.setAttribute("aria-label", cleanText(key));
  btn.innerHTML = icon(iconName);
  btn.addEventListener("click", onClick);
  return btn;
}

function inferImageMimeFromBase64(value, fallback = "image/png") {
  try {
    const raw = String(value || "").replace(/\s+/g, "");
    const head = atob(raw.slice(0, 32));
    const byte = index => head.charCodeAt(index);
    if (byte(0) === 0x89 && byte(1) === 0x50 && byte(2) === 0x4e && byte(3) === 0x47) return "image/png";
    if (byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff) return "image/jpeg";
    if (head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WEBP") return "image/webp";
  } catch {}
  return fallback;
}

function formatImageBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

async function readImageBlobDimensions(blob) {
  if (!(blob instanceof Blob)) return null;
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      const dimensions = { width: bitmap.width || null, height: bitmap.height || null };
      bitmap.close?.();
      if (dimensions.width && dimensions.height) return dimensions;
    } catch {}
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImageElement(objectUrl);
    return { width: image.naturalWidth || null, height: image.naturalHeight || null };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function renderOpenCodexResultMeta(element, record) {
  if (!element || !record?.requested || !record?.actual) return;
  const requested = record.requested;
  const actual = record.actual;
  const requestedText = requested.model === OPENCODEX_NANO_BANANA_2
    ? `${requested.aspectRatio || "auto"} · ${requested.imageSize || "1K"}`
    : `${requested.size || "auto"} · ${requested.quality || "auto"}`;
  const actualParts = [];
  if (actual.width && actual.height) actualParts.push(`${actual.width}×${actual.height}`);
  if (actual.responseQuality) actualParts.push(String(actual.responseQuality));
  if (actual.mimeType) actualParts.push(String(actual.mimeType).replace("image/", "").toUpperCase());
  if (actual.bytes) actualParts.push(formatImageBytes(actual.bytes));
  element.innerHTML = `
    <strong>${escapeHtml(OPENCODEX_CAPABILITIES[record.model]?.label || record.model || "OpenCodex")}</strong>
    <span>${escapeHtml(interpolate(cleanText("inpaintRequestedActual"), {
      requested: requestedText,
      actual: actualParts.join(" · ") || "—",
    }))}</span>`;
}

function replacePlaceholder(card, panelId, data, prompt, options = {}) {
  const item = (data.data || [])[0];
  let imageUrl = null;
  if (item) {
    if (item.url) imageUrl = item.url;
    else if (item.b64_json) imageUrl = `data:${item.mime_type || inferImageMimeFromBase64(item.b64_json)};base64,${item.b64_json}`;
  }
  if (!imageUrl) {
    markPlaceholderFailed(card, panelId, "API 未返回图片数据", options.retryContext);
    return;
  }
  const recordId = `img_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const originalImageUrl = item?.originalUrl || options.originalImageUrl ||
    (!/^(?:idb|cache):\/\//.test(String(imageUrl)) ? imageUrl : "");

  card.classList.remove("is-failed", "is-retry-queued");
  delete card.dataset.failed;
  delete card.dataset.errorMessage;
  delete card.dataset.queuePosition;
  delete card._retryQueuedSnapshot;
  card.dataset.status = "success";
  card.style.borderColor = "";
  card.title = "";
  card.innerHTML = "";
  setRetryContext(card, panelId, {
    ...(card._retryContext || {}),
    ...(options.retryContext || {}),
    prompt,
    fullPrompt: options.fullPrompt || options.retryContext?.fullPrompt || options.retryContext?.prompt || prompt,
  });
  const label = document.createElement("div");
  label.className = "panel-label";
  label.textContent = tr(`分镜 ${panelId}`);
  card.appendChild(label);

  const media = document.createElement("div");
  media.className = "result-media is-loading";
  const mediaStatus = document.createElement("div");
  mediaStatus.className = "result-media-status";
  const mediaStatusText = document.createElement("span");
  mediaStatusText.textContent = tr("图片加载中…");
  const reloadBtn = document.createElement("button");
  reloadBtn.type = "button";
  reloadBtn.className = "btn btn-sm result-media-reload";
  setButtonText(reloadBtn, "retry", "reloadImage");
  const img = document.createElement("img");
  let record = null;
  let actualDimensionResolve = null;
  const actualDimensionPromise = new Promise(resolve => { actualDimensionResolve = resolve; });
  let reloadAttempted = false;
  let previewReloadSeq = 0;
  img.alt = `分镜 ${panelId}`;
  img.loading = "lazy";
  img.decoding = "async";
  img.tabIndex = 0;
  img.setAttribute("role", "button");
  img.setAttribute("aria-label", `${cleanText("panelLabel")} ${panelId}`);
  img.addEventListener("load", () => {
    media.classList.remove("is-loading", "is-error");
    mediaStatusText.textContent = "";
    reloadBtn.disabled = false;
    if (record?.actual) {
      record.actual.width = img.naturalWidth || null;
      record.actual.height = img.naturalHeight || null;
      renderOpenCodexResultMeta(card.querySelector(".result-provider-meta"), record);
    }
    actualDimensionResolve?.({ width: img.naturalWidth || null, height: img.naturalHeight || null });
    actualDimensionResolve = null;
  });
  img.addEventListener("error", () => {
    media.classList.remove("is-loading");
    media.classList.add("is-error");
    reloadBtn.disabled = false;
    mediaStatusText.textContent = tr(reloadAttempted ? "重载失败，仍无法预览" : "图片链接暂时无法预览");
    actualDimensionResolve?.(null);
    actualDimensionResolve = null;
  });
  function setPreviewFromBlob(blob) {
    if (!(blob instanceof Blob) || blob.size <= 0) throw new Error("图片字节为空");
    const previousUrl = card._localImageUrl;
    const nextUrl = URL.createObjectURL(blob);
    card._zipBlob = blob;
    card._localImageUrl = nextUrl;
    if (previousUrl && previousUrl !== nextUrl) {
      setTimeout(() => URL.revokeObjectURL(previousUrl), 1000);
    }
    img.removeAttribute("src");
    img.src = nextUrl;
  }

  async function reloadPreviewFromBytes(force = false) {
    const seq = ++previewReloadSeq;
    reloadAttempted = true;
    reloadBtn.disabled = true;
    media.classList.remove("is-error");
    media.classList.add("is-loading");
    mediaStatusText.textContent = tr("图片重新加载中…");
    try {
      // “强制重载”必须丢弃上一次失败的 Blob。旧逻辑即使 force=true 仍先复用
      // card._zipBlob，导致用户每点一次都把同一份坏缓存重新塞给 <img>。
      let blob = force ? null : card._zipBlob;
      if (!blob && !force && card._imageCachePromise) {
        blob = await card._imageCachePromise;
      }
      if (!blob) {
        card._imageCachePromise = imageUrlToBlobWithFallback(imageUrl, originalImageUrl)
          .then(async freshBlob => {
            await putGeneratedCacheBlob(card._generatedCacheKey, freshBlob);
            return freshBlob;
          });
        blob = await card._imageCachePromise;
      }
      if (seq !== previewReloadSeq || !img.isConnected) return;
      await setPreviewFromBlob(blob);
    } catch (err) {
      if (seq !== previewReloadSeq || !img.isConnected) return;
      console.warn(`分镜 ${panelId} 图片重新加载失败`, err);
      media.classList.remove("is-loading");
      media.classList.add("is-error");
      reloadBtn.disabled = false;
      mediaStatusText.textContent = tr("重载失败，仍无法预览");
    }
  }

  reloadBtn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    void reloadPreviewFromBytes(true);
  });
  img.addEventListener("click", () => {
    if (!media.classList.contains("is-error")) openLightbox(card._localImageUrl || imageUrl);
  });
  img.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!media.classList.contains("is-error")) void openLightbox(card._localImageUrl || imageUrl);
  });
  mediaStatus.append(mediaStatusText, reloadBtn);
  media.append(img, mediaStatus);
  card.appendChild(media);
  if (!/^(?:idb|cache):\/\//.test(String(imageUrl))) img.src = imageUrl;
  const isProjectContext = options.retryContext?.mode === "comic" || options.retryContext?.mode === "caption";
  const recordPrompt = options.recordPrompt
    ?? (isProjectContext ? getPanelOnlyPrompt(options.retryContext, options.retryContext?.globalPrompt || "") : prompt);
  const fullPrompt = options.fullPrompt || options.retryContext?.fullPrompt || (recordPrompt !== prompt ? prompt : "");
  const billing = options.billing || buildOfficialBilling(data);
  const usage = options.usage || billing?.usage || normalizeOfficialUsage(data);

  card._zipImage = {
    url: imageUrl,
    originalUrl: originalImageUrl,
    panelId: String(panelId),
    prompt: recordPrompt,
    panelPrompt: options.retryContext?.panelPrompt || (isProjectContext ? recordPrompt : ""),
    fullPrompt,
    billing,
    usage,
  };

  // 中转站的生图 URL 存活期很短（实测约 2 小时后服务端删图），页面上 <img> 靠浏览器
  // 缓存还能显示，但导出/下载时重新请求远程 URL 会 404。趁 URL 刚生成还活着，立刻把
  // 字节抓到本地；之后 ZIP 打包、单图下载、灯箱都优先用本地副本。
  releaseCardImageCache(card);
  card._generatedCacheKey = String(imageUrl).startsWith("cache://")
    ? String(imageUrl).slice(8)
    : sanitizeFilePart(recordId, "generated");
  card._imageCachePromise = (String(imageUrl).startsWith("cache://")
    ? getGeneratedCacheBlob(card._generatedCacheKey)
    : imageUrlToBlobWithFallback(imageUrl, originalImageUrl).then(async blob => {
        await putGeneratedCacheBlob(card._generatedCacheKey, blob);
        return blob;
      }))
    .then(blob => {
        if (!(blob instanceof Blob)) throw new Error("本地图片缓存不存在");
        if (img.isConnected) setPreviewFromBlob(blob);
        void cleanupGeneratedImageCache().catch(err => console.warn("自动清理生成图片缓存失败", err));
        return blob;
      })
    .catch(err => {
      console.warn(`分镜 ${panelId} 图片本地缓存失败，导出时将回退远程下载`, err);
      return null;
    });

  renderResultBilling(card, billing);

  const openCodexMeta = data?._openCodex || null;
  const providerMeta = document.createElement("div");
  providerMeta.className = "result-provider-meta";
  if (!openCodexMeta) providerMeta.classList.add("hidden");
  card.appendChild(providerMeta);

  const actions = document.createElement("div");
  actions.className = "result-actions";
  actions.append(
    makeCardActionBtn("download", "download", () => downloadImage(card._zipBlob || card._localImageUrl || imageUrl, panelId, originalImageUrl)),
    makeCardActionBtn("copy", "copyLink", () => copyImageUrl(imageUrl, originalImageUrl)),
    makeCardActionBtn("retry", "retry", () => retryResultCard(card, false)),
    makeCardActionBtn("edit", "editRetry", () => retryResultCard(card, true)),
    makeCardActionBtn("mask", "openInpaint", () => void openInpaintFromCard(card))
  );
  card.appendChild(actions);

  record = {
    id: recordId,
    createdAt: new Date().toISOString(),
    mode: options.mode || options.retryContext?.mode || currentMode,
    panelId: String(panelId),
    prompt: recordPrompt,
    panelPrompt: options.retryContext?.panelPrompt || (isProjectContext ? recordPrompt : ""),
    fullPrompt,
    model: openCodexMeta?.requested?.model || dom.model.value.trim(),
    endpoint: dom.apiEndpoint.value.trim(),
    size: options.size || options.retryContext?.size || getSelectedSize(),
    imageUrl,
    originalUrl: originalImageUrl,
    retryCount: options.retryContext?.retryCount ?? getGlobalRetryCount(),
    billing,
    usage,
    provider: openCodexMeta?.provider || options.provider || "",
    operation: openCodexMeta?.operation || options.operation ||
      ((options.retryContext?.references?.length || referenceImages.length) ? "edit" : "generation"),
    requested: openCodexMeta?.requested ? { ...openCodexMeta.requested } : null,
    actual: openCodexMeta ? {
      mimeType: item?.mime_type || openCodexMeta.response?.mimeType || (item?.b64_json ? inferImageMimeFromBase64(item.b64_json) : null),
      responseQuality: openCodexMeta.response?.quality || null,
      responseSize: openCodexMeta.response?.size || null,
      width: null,
      height: null,
      bytes: null,
    } : null,
    inpaint: options.inpaint ? { ...options.inpaint } : null,
    _cachePromise: card._imageCachePromise,
    _cacheKey: card._generatedCacheKey,
  };
  if (openCodexMeta) {
    providerMeta.classList.remove("hidden");
    renderOpenCodexResultMeta(providerMeta, record);
    const cachedBlobPromise = Promise.resolve(card._imageCachePromise).catch(() => null);
    const decodedBlobDimensions = cachedBlobPromise
      .then(blob => readImageBlobDimensions(blob))
      .catch(() => null);
    const dimensionFallback = new Promise(resolve => setTimeout(() => resolve(null), 3000));
    record._actualMetaPromise = Promise.all([
      Promise.race([actualDimensionPromise.catch(() => null), decodedBlobDimensions, dimensionFallback]),
      cachedBlobPromise,
    ]).then(([dimensions, blob]) => {
      if (dimensions) {
        record.actual.width = dimensions.width;
        record.actual.height = dimensions.height;
      }
      if (blob instanceof Blob) {
        record.actual.bytes = blob.size;
        record.actual.mimeType = blob.type || record.actual.mimeType;
      }
      renderOpenCodexResultMeta(providerMeta, record);
      return record.actual;
    });
  } else {
    actualDimensionResolve?.(null);
    actualDimensionResolve = null;
  }
  generatedImageUrls.push({ url: imageUrl, panelId: String(panelId), prompt, recordId: record.id });
  if (!options.skipHistory && record.mode !== "comic") saveGenerationRecord(record);
  updateFailedRetryTools();
  return record;
}

function releaseCardImageCache(card) {
  if (card._localImageUrl) URL.revokeObjectURL(card._localImageUrl);
  card._localImageUrl = "";
  card._zipBlob = null;
  card._imageCachePromise = null;
  card._generatedCacheKey = "";
}

function markPlaceholderFailed(card, panelId, errMsg, retryContext = {}) {
  const message = String(errMsg || "生成失败");
  setRetryContext(card, panelId, { ...(card._retryContext || {}), ...(retryContext || {}) });
  card.classList.remove("is-retry-queued");
  card.classList.add("is-failed");
  card.dataset.failed = "true";
  card.dataset.status = "failed";
  card.dataset.errorMessage = message;
  delete card.dataset.queuePosition;
  delete card._retryQueuedSnapshot;
  delete card._zipImage;
  releaseCardImageCache(card);
  card.innerHTML = `
    <div class="panel-label">${escapeHtml(tr(`分镜 ${panelId}`))}</div>
    <div class="result-media result-media-failed">
      <div class="result-error">
        <strong><span class="ui-icon ui-icon-retry"></span> ${escapeHtml(tr("失败"))}</strong>
        <small>${escapeHtml(cleanText("failReason"))}</small>
        <span class="result-error-message">${escapeHtml(message.slice(0, 500))}</span>
      </div>
    </div>
    <div class="result-actions">
      <button type="button" class="btn btn-sm card-action retry-now" title="${escapeHtml(cleanText("retry"))}" aria-label="${escapeHtml(cleanText("retry"))}">${icon("retry")}</button>
      <button type="button" class="btn btn-sm card-action edit-retry" title="${escapeHtml(cleanText("editRetry"))}" aria-label="${escapeHtml(cleanText("editRetry"))}">${icon("edit")}</button>
    </div>`;
  card.style.borderColor = "var(--error)";
  card.title = message;
  card.querySelector(".retry-now")?.addEventListener("click", () => retryResultCard(card, false));
  card.querySelector(".edit-retry")?.addEventListener("click", () => retryResultCard(card, true));
  updateFailedRetryTools();
}

function getFailedResultCards() {
  if (!dom.resultGrid) return [];
  return Array.from(dom.resultGrid.querySelectorAll(".result-item.is-failed, .result-item[data-failed='true']"))
    .filter(card => card.isConnected);
}

function setRetryFailedButtonText(count = getFailedResultCards().length) {
  if (!dom.retryFailedAll) return;
  if (retryAllFailedRun) {
    const key = retryAllFailedRun.cancelRequested ? "cancellingRetryFailedAll" : "cancelRetryFailedAll";
    dom.retryFailedAll.innerHTML = `${icon("x")} ${cleanText(key)} (${retryAllFailedRun.cards.length})`;
    return;
  }
  const suffix = count > 0 ? ` (${count})` : "";
  dom.retryFailedAll.innerHTML = `${icon("retry")} ${cleanText("retryFailedAll")}${suffix}`;
}

function renderRetryQueued(card, position, run = retryAllFailedRun) {
  if (!card?.isConnected) return;
  const context = card._retryContext || {};
  const panelId = context.panelId || card.dataset.panelId || "重试";
  const message = String(card.dataset.errorMessage || "生成失败");
  if (!card._retryQueuedSnapshot) {
    card._retryQueuedSnapshot = {
      panelId,
      message,
      context: { ...context },
    };
  }
  card.classList.add("is-failed", "is-retry-queued");
  card.dataset.failed = "true";
  card.dataset.status = "queued";
  card.dataset.queuePosition = String(position);
  card.style.borderColor = "";
  card.title = message;
  const completedAttempts = run?.attempts?.get(card) || 0;
  const nextAttempt = Math.min(completedAttempts + 1, run?.maxAttempts || 1);
  const maxAttempts = run?.maxAttempts || 1;
  card.innerHTML = `
    <div class="panel-label">${escapeHtml(tr(`分镜 ${panelId}`))}</div>
    <div class="result-media result-media-queued">
      <span class="ui-icon ui-icon-retry retry-queued-icon" aria-hidden="true"></span>
      <strong class="retry-queue-position">${escapeHtml(interpolate(cleanText("retryQueued"), { position }))}</strong>
      <span class="retry-queue-round">${escapeHtml(interpolate(cleanText("retryQueuedRound"), { attempt: nextAttempt, maxAttempts }))}</span>
      <small>${escapeHtml(cleanText("retryQueuedHint"))}</small>
    </div>
    <div class="result-actions retry-queued-error" title="${escapeHtml(message)}">
      <span>${escapeHtml(message.slice(0, 160))}</span>
    </div>`;
}

function refreshRetryQueuePositions(run) {
  if (!run) return;
  run.pendingCards = run.pendingCards.filter(card => card?.isConnected);
  run.pendingCards.forEach((card, index) => {
    const position = index + 1;
    if (card.dataset.status !== "queued") renderRetryQueued(card, position, run);
    card.dataset.queuePosition = String(position);
    const label = card.querySelector(".retry-queue-position");
    if (label) label.textContent = interpolate(cleanText("retryQueued"), { position });
    const round = card.querySelector(".retry-queue-round");
    if (round) {
      const attempt = Math.min((run.attempts?.get(card) || 0) + 1, run.maxAttempts || 1);
      round.textContent = interpolate(cleanText("retryQueuedRound"), { attempt, maxAttempts: run.maxAttempts || 1 });
    }
  });
}

function restoreQueuedRetryCard(card) {
  const snapshot = card?._retryQueuedSnapshot;
  if (!card?.isConnected || !snapshot) return;
  markPlaceholderFailed(card, snapshot.panelId, snapshot.message, snapshot.context);
}

function enqueueFailedCardsForRetryRun(run, cards = getFailedResultCards()) {
  if (!run || run.cancelRequested || run.finished) return 0;
  let added = 0;
  cards.forEach(card => {
    if (!card?.isConnected || run.seenCards.has(card)) return;
    run.seenCards.add(card);
    run.cards.push(card);
    run.pendingCards.push(card);
    added++;
  });
  if (added > 0) {
    refreshRetryQueuePositions(run);
    if (run.idleTimer !== null) {
      clearTimeout(run.idleTimer);
      run.idleTimer = null;
    }
    if (run.started) {
      showStatus(interpolate(cleanText("retryFailedAllStarted"), { count: run.cards.length }), "info");
    }
    run.pump?.();
  }
  return added;
}

function getUntrackedFailedCards(run = retryAllFailedRun) {
  if (!run) return [];
  return getFailedResultCards().filter(card => !run.seenCards.has(card));
}

function updateFailedRetryTools() {
  if (retryAllFailedRun) {
    // “全部失败重试”运行期间，其他生成任务仍可能继续产生新的失败卡。
    // 这里在每次失败卡状态刷新时把新卡加入当前动态队列；同一张卡重试后仍失败时，
    // 调度器会依据 maxAttempts 主动放回队尾，不依赖这次 DOM 扫描重复入队。
    enqueueFailedCardsForRetryRun(retryAllFailedRun);
  }
  const count = getFailedResultCards().length;
  const hasActiveRun = !!retryAllFailedRun;
  dom.retryFailedTools?.classList.toggle("hidden", count === 0 && !hasActiveRun);
  if (dom.retryFailedAll) {
    dom.retryFailedAll.disabled = hasActiveRun ? !!retryAllFailedRun.cancelRequested : count === 0;
    dom.retryFailedAll.classList.toggle("is-cancel", hasActiveRun);
    setRetryFailedButtonText(count);
  }
  if (dom.enqueueRemainingFailed) {
    const remaining = hasActiveRun ? getUntrackedFailedCards(retryAllFailedRun).length : 0;
    dom.enqueueRemainingFailed.classList.toggle("hidden", !hasActiveRun);
    // 即使当前扫描为 0 也保持可点：这个按钮就是自动收集链路失灵时的人工保险入口。
    dom.enqueueRemainingFailed.disabled = !hasActiveRun || !!retryAllFailedRun?.cancelRequested;
    dom.enqueueRemainingFailed.innerHTML = `${icon("plus")} ${cleanText("enqueueRemainingFailed")}${remaining > 0 ? ` (${remaining})` : ""}`;
  }
}

function getFailedRetryCount() {
  const retryCount = clampRetryCount(dom.failedRetryCount?.value, getGlobalRetryCount());
  if (dom.failedRetryCount) dom.failedRetryCount.value = String(retryCount);
  return retryCount;
}

function cancelRetryAllFailedRun({ announce = true } = {}) {
  const run = retryAllFailedRun;
  if (!run) return false;
  run.suppressCompletionStatus ||= !announce;
  if (!run.cancelRequested) {
    run.cancelRequested = true;
    run.cards.forEach(card => card._cardRetryAbortController?.abort());
    const queuedCards = run.pendingCards.splice(0);
    queuedCards.forEach(restoreQueuedRetryCard);
    if (run.idleTimer !== null) {
      clearTimeout(run.idleTimer);
      run.idleTimer = null;
    }
    run.pump?.();
  }
  if (announce) showStatus(cleanText("cancellingRetryFailedAll"), "info");
  updateFailedRetryTools();
  return true;
}

function executeRetryAllFailedRun(run) {
  const concurrency = getProviderConcurrency();
  return new Promise(resolve => {
    const finish = () => {
      if (run.finished) return;
      run.finished = true;
      if (run.idleTimer !== null) clearTimeout(run.idleTimer);
      run.idleTimer = null;
      resolve();
    };

    run.pump = () => {
      if (run.finished) return;
      if (run.cancelRequested) run.pendingCards.length = 0;

      while (!run.cancelRequested && run.activeCount < concurrency && run.pendingCards.length > 0) {
        const card = run.pendingCards.shift();
        refreshRetryQueuePositions(run);
        const attempt = (run.attempts.get(card) || 0) + 1;
        run.attempts.set(card, attempt);
        run.activeCount++;
        void (async () => {
          let result = null;
          let terminal = false;
          try {
            if (card?.isConnected && card.classList.contains("is-failed")) {
              result = await retryResultCard(card, false, {
                // “失败后追加次数”由本层统一控制。单次调用不再嵌套 HTTP 400 自动重试，
                // 否则填写 10 会变成 11 个队列轮次 × 每轮 11 次请求。
                retryCountOverride: 0,
                quiet: true,
                bulkRetryAttempt: attempt,
                bulkRetryMaxAttempts: run.maxAttempts,
              });
            }
            if (result === true) {
              run.ok++;
              terminal = true;
            } else if (!run.cancelRequested && card?.isConnected && card.classList.contains("is-failed") && attempt < run.maxAttempts) {
              // 失败后放到队尾，先让其它卡片获得请求机会；成功后不会走到这里。
              run.pendingCards.push(card);
              run.requeued++;
              refreshRetryQueuePositions(run);
            } else {
              run.failed++;
              terminal = true;
            }
          } catch {
            run.failed++;
            terminal = true;
          } finally {
            if (terminal) run.done++;
            run.activeCount--;
            updateProgress(run.done, Math.max(run.done, run.cards.length), run.done >= run.cards.length ? "✅" : "⏳");
            updateFailedRetryTools();
            run.pump();
          }
        })();
      }

      if (run.activeCount !== 0 || run.pendingCards.length !== 0) return;
      if (run.cancelRequested) {
        finish();
        return;
      }
      // 留出一个短暂空闲窗口，接住与最后一个重试几乎同时落下的新失败卡。
      // 更晚出现的失败卡会在 finally 释放全局锁后显示为下一轮可重试项。
      if (run.idleTimer === null) {
        run.idleTimer = setTimeout(() => {
          run.idleTimer = null;
          if (run.activeCount === 0 && run.pendingCards.length === 0) finish();
          else run.pump();
        }, 150);
      }
    };

    run.pump();
  });
}

async function retryAllFailedResults() {
  if (retryAllFailedRun) {
    cancelRetryAllFailedRun();
    return;
  }
  const cards = getFailedResultCards();
  if (!cards.length) {
    updateFailedRetryTools();
    showStatus(cleanText("noFailedToRetry"), "info");
    return;
  }

  const additionalRetryCount = getFailedRetryCount();
  const run = {
    cards: [],
    pendingCards: [],
    seenCards: new Set(),
    attempts: new Map(),
    maxAttempts: additionalRetryCount + 1,
    activeCount: 0,
    done: 0,
    ok: 0,
    failed: 0,
    requeued: 0,
    idleTimer: null,
    pump: null,
    finished: false,
    started: false,
    cancelRequested: false,
    suppressCompletionStatus: false,
  };
  retryAllFailedRun = run;
  enqueueFailedCardsForRetryRun(run, cards);
  updateFailedRetryTools();
  showStatus(interpolate(cleanText("retryFailedAllStarted"), { count: run.cards.length }), "info");
  run.started = true;

  // 超时被放宽到 15 分钟后，单张卡片重试失败前可能要等很久——如果整个过程完全没有中间反馈，
  // 按钮从点击到重新可用之间会显得像卡死了。复用批量生成同一套 #progressWrap/updateProgress
  // 进度条，让"已完成 done/total"实时可见，而不是干等一个不会变化的按钮文字。
  dom.progressWrap.classList.remove("hidden");
  updateProgress(0, run.cards.length, "⏳");

  try {
    await executeRetryAllFailedRun(run);
    if (run.cancelRequested && !run.suppressCompletionStatus) {
      showStatus(cleanText("retryFailedAllCancelled"), "info");
    } else if (!run.cancelRequested) {
      showStatus(run.failed > 0 ? `重试完成：${run.ok} 成功 / ${run.failed} 失败` : `已重试成功 ${run.ok} 个失败分镜`, run.failed > 0 ? "error" : "success");
    }
  } finally {
    if (retryAllFailedRun === run) {
      retryAllFailedRun = null;
      updateFailedRetryTools();
      setTimeout(() => dom.progressWrap.classList.add("hidden"), 3000);
    }
  }
}

function setRetryContext(card, panelId, context = {}) {
  card._retryContext = {
    panelId: String(panelId),
    mode: currentMode,
    size: getSelectedSize(),
    prompt: "",
    globalPrompt: "",
    panelPrompt: "",
    references: null,
    ...context,
  };
}

function composeRetryPrompt(context) {
  if (context.mode === "comic" || context.mode === "caption") {
    return context.globalPrompt ? `${context.globalPrompt}\n\n${context.panelPrompt || ""}`.trim() : (context.panelPrompt || context.prompt || "");
  }
  return context.prompt || "";
}

async function editRetryContext(context) {
  const next = { ...context };
  if (next.mode === "comic" || next.mode === "caption") {
    const label = next.mode === "caption"
      ? "修改气泡文字内容（全局提示词会自动引用当前页面里的内容）"
      : "修改该分镜提示词（全局提示词会自动引用当前页面里的内容）";
    const panel = await askPrompt(label, next.panelPrompt || next.prompt || "");
    if (panel === null) return null;
    next.globalPrompt = getEffectivePrompt();
    next.panelPrompt = panel.trim();
    next.prompt = composeRetryPrompt(next);
    return next;
  }
  const edited = await askPrompt("修改提示词后重试", next.prompt || "");
  if (edited === null) return null;
  next.prompt = edited.trim();
  return next;
}

function renderRetryLoading(card, panelId, promptText, options = {}) {
  card.classList.remove("is-failed", "is-retry-queued");
  delete card.dataset.failed;
  delete card.dataset.errorMessage;
  delete card.dataset.queuePosition;
  delete card._retryQueuedSnapshot;
  if (options.bulkRetryAttempt) {
    card.dataset.retryAttempt = String(options.bulkRetryAttempt);
    card.dataset.retryMaxAttempts = String(options.bulkRetryMaxAttempts || options.bulkRetryAttempt);
  }
  delete card._zipImage;
  releaseCardImageCache(card);
  card.dataset.status = "loading";
  card.style.borderColor = "";
  card.title = "";
  card.innerHTML = `
    <div class="panel-label">${escapeHtml(tr(`分镜 ${panelId}`))}</div>
    <div class="result-media result-media-loading">
      <div class="spinner" style="width:28px;height:28px;"></div>
      <div style="font-size:0.82rem;">${escapeHtml(tr("正在重试生成…"))}</div>
      <div class="bulk-retry-round-label${options.bulkRetryAttempt ? "" : " hidden"}">${options.bulkRetryAttempt ? escapeHtml(interpolate(cleanText("bulkRetryRound"), { attempt: options.bulkRetryAttempt, maxAttempts: options.bulkRetryMaxAttempts || options.bulkRetryAttempt })) : ""}</div>
      <div class="retry-attempt-label hidden"></div>
      <button type="button" class="btn btn-xs stop-card-retry" title="${escapeHtml(cleanText("stopCardRetry"))}"><span class="ui-icon ui-icon-x"></span></button>
    </div>
    <div class="result-actions">
      <span style="font-size:0.75rem;color:var(--text2);padding:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;" title="${escapeHtml(promptText)}">${escapeHtml(promptText.slice(0, 80))}</span>
    </div>`;
  wireCardStopRetryButton(card);
  updateFailedRetryTools();
}

async function retryResultCard(card, editBeforeRetry = false, options = {}) {
  const currentContext = card._retryContext || {};
  let context = { ...currentContext };
  if (editBeforeRetry) {
    context = await editRetryContext(context);
    if (!context) return false;
  }
  const promptText = composeRetryPrompt(context);
  if (!promptText) {
    showStatus("重试前请先填写提示词", "error");
    return false;
  }
  const panelId = context.panelId || card.dataset.panelId || "重试";
  const size = context.size || getSelectedSize();
  const retryCount = clampRetryCount(options.retryCountOverride ?? context.retryCount, getGlobalRetryCount());
  const isProject = context.mode === "comic" || context.mode === "caption";
  const label = context.mode === "caption" ? "图片" : "分镜";
  setRetryContext(card, panelId, { ...context, prompt: promptText, size, retryCount });
  renderRetryLoading(card, panelId, promptText, options);
  const cardAbort = new AbortController();
  card._cardRetryAbortController = cardAbort;
  try {
    const references = Array.isArray(context.references) ? context.references : undefined;
    const data = await callImageAPI(promptText, size, 1, `${label} ${panelId}`, {
      references, maxRetries: retryCount, signal: cardAbort.signal,
      onRetryAttempt: info => updateCardRetryAttempt(card, info),
    });
    const record = replacePlaceholder(card, panelId, data, promptText, {
      skipHistory: true, // 重试的历史记录更新自己接管（原地替换旧图），不走默认的“新增一条”逻辑
      recordPrompt: isProject ? getPanelOnlyPrompt(context, context.globalPrompt || "") : promptText,
      fullPrompt: promptText,
      retryContext: { ...context, prompt: promptText, fullPrompt: promptText, size, retryCount },
    });
    // HTTP 200 不等于生图成功；中转站偶尔会返回空 data。replacePlaceholder() 已将卡片
    // 标为失败，这里必须把 false 交回“全部重试”调度器继续下一轮，只有真实图片才停止。
    if (!record) return false;
    if (record) {
      if (isProject) {
        await updateComicHistoryPanel(currentComicHistoryId, panelId, record);
      } else {
        await replaceSingleHistoryRecord(card._historyRecordId, record);
        card._historyRecordId = record.id;
      }
    }
    if (!options.quiet) showStatus(`${label} ${panelId} 重试成功`, "success");
    return true;
  } catch (err) {
    if (err?.name === "AbortError" && cardAbort.signal.aborted) {
      markPlaceholderFailed(card, panelId, "已手动取消", { ...context, prompt: promptText, size, retryCount });
      if (!options.quiet) showStatus(`${label} ${panelId} 已手动取消`, "info");
      return false;
    }
    markPlaceholderFailed(card, panelId, err.message || String(err), { ...context, prompt: promptText, size, retryCount });
    if (!options.quiet) showStatus(`${label} ${panelId} 重试失败: ${err.message || err}`, "error");
    return false;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function stripGlobalPromptFromText(text = "", globalPrompt = "") {
  const raw = String(text || "").trim();
  const global = String(globalPrompt || "").trim();
  if (!raw || !global) return raw;
  if (raw === global) return "";
  if (raw.startsWith(global)) {
    return raw.slice(global.length).replace(/^\s+/, "").trim();
  }
  return raw;
}

function getPanelOnlyPrompt(source = {}, globalPrompt = "") {
  const panelPrompt = String(source.panelPrompt || "").trim();
  if (panelPrompt) return panelPrompt;
  const prompt = String(source.prompt || "").trim();
  if (prompt) return stripGlobalPromptFromText(prompt, globalPrompt);
  return stripGlobalPromptFromText(source.fullPrompt || "", globalPrompt);
}

function addPromptCollapseToggle(container, promptEl, text) {
  if (!container || !promptEl || String(text || "").length <= 90) return;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "history-prompt-toggle";
  toggle.textContent = cleanText("expand");
  toggle.addEventListener("click", () => {
    const expanded = promptEl.classList.toggle("expanded");
    toggle.textContent = expanded ? cleanText("collapse") : cleanText("expand");
  });
  container.appendChild(toggle);
}

// ═══════════════════════════════════════════════════════════
//  生图历史记录（本地存储，电脑端 / 安卓端共用）
// ═══════════════════════════════════════════════════════════

const HISTORY_KEY = "ai_image_gen_history_v1";
const HISTORY_BLOB_DB = "ai_image_generator_history";
const HISTORY_BLOB_STORE = "images";
const GENERATED_CACHE_STORE = "generated_cache";
const GENERATED_CACHE_META_STORE = "generated_cache_meta";
const GENERATED_CACHE_CREATED_AT_INDEX = "created_at";
let historyBlobDbPromise = null;
let historyBlobPruneQueue = Promise.resolve();
let generatedCacheCleanupQueue = Promise.resolve();
let lastGeneratedCacheCleanupAt = 0;

function openHistoryBlobDb() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  if (historyBlobDbPromise) return historyBlobDbPromise;
  historyBlobDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_BLOB_DB, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HISTORY_BLOB_STORE)) {
        request.result.createObjectStore(HISTORY_BLOB_STORE);
      }
      if (!request.result.objectStoreNames.contains(GENERATED_CACHE_STORE)) {
        request.result.createObjectStore(GENERATED_CACHE_STORE);
      }
      const metaStore = request.result.objectStoreNames.contains(GENERATED_CACHE_META_STORE)
        ? request.transaction.objectStore(GENERATED_CACHE_META_STORE)
        : request.result.createObjectStore(GENERATED_CACHE_META_STORE);
      if (!metaStore.indexNames.contains(GENERATED_CACHE_CREATED_AT_INDEX)) {
        metaStore.createIndex(GENERATED_CACHE_CREATED_AT_INDEX, "createdAt");
      }
      // Legacy cache entries intentionally remain without metadata. Migrating a
      // multi-gigabyte cache inside the versionchange transaction can block the
      // packaged WebView at startup. New writes receive metadata normally, and
      // users can still clear all legacy entries with the cache-clear action.
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("历史图片数据库打开失败"));
  });
  return historyBlobDbPromise;
}

async function putHistoryBlob(key, blob) {
  const db = await openHistoryBlobDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_BLOB_STORE, "readwrite");
    tx.objectStore(HISTORY_BLOB_STORE).put(blob, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("历史图片写入失败"));
    tx.onabort = () => reject(tx.error || new Error("历史图片写入已中止"));
  });
}

async function getHistoryBlob(key) {
  const db = await openHistoryBlobDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(HISTORY_BLOB_STORE, "readonly").objectStore(HISTORY_BLOB_STORE).get(key);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error || new Error("历史图片读取失败"));
  });
}

async function putGeneratedCacheBlob(key, blob, createdAt = Date.now()) {
  if (!(blob instanceof Blob) || blob.size <= 0) throw new Error("图片缓存字节为空");
  const db = await openHistoryBlobDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([GENERATED_CACHE_STORE, GENERATED_CACHE_META_STORE], "readwrite");
    tx.objectStore(GENERATED_CACHE_STORE).put({ blob, createdAt: Number(createdAt) || Date.now() }, key);
    tx.objectStore(GENERATED_CACHE_META_STORE).put({ createdAt: Number(createdAt) || Date.now() }, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("生成图片缓存写入失败"));
    tx.onabort = () => reject(tx.error || new Error("生成图片缓存写入已中止"));
  });
}

async function getGeneratedCacheBlob(key) {
  const db = await openHistoryBlobDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(GENERATED_CACHE_STORE, "readonly").objectStore(GENERATED_CACHE_STORE).get(key);
    request.onsuccess = () => {
      const value = request.result;
      resolve(value?.blob instanceof Blob ? value.blob : (value instanceof Blob ? value : null));
    };
    request.onerror = () => reject(request.error || new Error("生成图片缓存读取失败"));
  });
}

async function clearGeneratedCacheStore() {
  const db = await openHistoryBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([GENERATED_CACHE_STORE, GENERATED_CACHE_META_STORE], "readwrite");
    let count = 0;
    const store = tx.objectStore(GENERATED_CACHE_STORE);
    const countRequest = store.count();
    countRequest.onsuccess = () => { count = Number(countRequest.result || 0); };
    store.clear();
    tx.objectStore(GENERATED_CACHE_META_STORE).clear();
    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error || new Error("生成图片缓存清理失败"));
  });
}

async function cleanupGeneratedImageCache({ now = Date.now(), updateStatus = false, force = false } = {}) {
  if (!force && !updateStatus && Number(now) - lastGeneratedCacheCleanupAt < 60 * 60 * 1000) return 0;
  lastGeneratedCacheCleanupAt = Number(now);
  const retentionDays = Math.min(365, Math.max(1, Number(loadSettings().cacheRetentionDays) || 7));
  const cutoff = Number(now) - retentionDays * 24 * 60 * 60 * 1000;
  generatedCacheCleanupQueue = generatedCacheCleanupQueue.catch(() => {}).then(async () => {
    const db = await openHistoryBlobDb();
    let removed = 0;
    await new Promise((resolve, reject) => {
      const tx = db.transaction([GENERATED_CACHE_STORE, GENERATED_CACHE_META_STORE], "readwrite");
      const generatedStore = tx.objectStore(GENERATED_CACHE_STORE);
      const metaStore = tx.objectStore(GENERATED_CACHE_META_STORE);
      const createdAtIndex = metaStore.index(GENERATED_CACHE_CREATED_AT_INDEX);
      const request = createdAtIndex.openKeyCursor(IDBKeyRange.upperBound(cutoff, true));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        generatedStore.delete(cursor.primaryKey);
        metaStore.delete(cursor.primaryKey);
        removed += 1;
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("生成图片缓存自动清理失败"));
    });
    if (updateStatus && dom.generatedCacheStatus) {
      dom.generatedCacheStatus.dataset.customStatus = "true";
      dom.generatedCacheStatus.textContent = interpolate(cleanText("cacheCleared"), { count: removed });
    }
    return removed;
  });
  try {
    return await generatedCacheCleanupQueue;
  } catch (err) {
    lastGeneratedCacheCleanupAt = 0;
    if (updateStatus && dom.generatedCacheStatus) {
      dom.generatedCacheStatus.dataset.customStatus = "true";
      dom.generatedCacheStatus.textContent = interpolate(cleanText("cacheCleanupFailed"), { reason: err.message || String(err) });
    }
    throw err;
  }
}

async function clearGeneratedImageCacheFromSettings() {
  try {
    const count = await clearGeneratedCacheStore();
    if (dom.generatedCacheStatus) {
      dom.generatedCacheStatus.dataset.customStatus = "true";
      dom.generatedCacheStatus.textContent = interpolate(cleanText("cacheCleared"), { count });
    }
  } catch (err) {
    if (dom.generatedCacheStatus) {
      dom.generatedCacheStatus.dataset.customStatus = "true";
      dom.generatedCacheStatus.textContent = interpolate(cleanText("cacheCleanupFailed"), { reason: err.message || String(err) });
    }
  }
}

async function clearHistoryBlobStore() {
  try {
    const db = await openHistoryBlobDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_BLOB_STORE, "readwrite");
      tx.objectStore(HISTORY_BLOB_STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("清理历史图片数据库失败", err);
  }
}

function collectHistoryBlobKeys(list) {
  const keys = new Set();
  const add = value => {
    if (String(value || "").startsWith("idb://")) keys.add(String(value).slice(6));
  };
  (list || []).forEach(item => {
    add(item?.imageUrl);
    getHistoryImages(item).forEach(image => add(image.imageUrl));
  });
  return keys;
}

async function pruneHistoryBlobStore(list) {
  try {
    const keep = collectHistoryBlobKeys(list);
    const db = await openHistoryBlobDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_BLOB_STORE, "readwrite");
      const request = tx.objectStore(HISTORY_BLOB_STORE).openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!keep.has(String(cursor.key))) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("整理历史图片数据库失败", err);
  }
}

function scheduleHistoryBlobPrune() {
  historyBlobPruneQueue = historyBlobPruneQueue
    .catch(() => {})
    .then(() => pruneHistoryBlobStore(loadHistory()));
  return historyBlobPruneQueue;
}

function releaseHistoryPreviewUrls(root = dom.historyList) {
  root?.querySelectorAll?.("img[data-history-object-url]").forEach(img => {
    URL.revokeObjectURL(img.dataset.historyObjectUrl);
  });
}

async function setHistoryImageSource(img, imageUrl, fallbackUrl = "") {
  if (!img || !imageUrl) return;
  if (!/^(?:idb|cache):\/\//.test(String(imageUrl))) {
    img.src = imageUrl;
    return;
  }
  try {
    const blob = String(imageUrl).startsWith("cache://")
      ? await getGeneratedCacheBlob(String(imageUrl).slice(8))
      : await getHistoryBlob(String(imageUrl).slice(6));
    if (!blob) {
      if (fallbackUrl && img.isConnected) img.src = fallbackUrl;
      return;
    }
    if (!img.isConnected) return;
    const objectUrl = URL.createObjectURL(blob);
    img.dataset.historyObjectUrl = objectUrl;
    img.src = objectUrl;
  } catch (err) {
    if (fallbackUrl && img.isConnected) img.src = fallbackUrl;
    console.warn("历史图片预览加载失败", err);
  }
}

function loadHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function isHistoryProject(item) {
  return item?.type === "comic-project" || item?.type === "caption-project"
    || (Array.isArray(item?.images) && (item.mode === "comic" || item.mode === "caption"));
}

function getHistoryImages(item) {
  return Array.isArray(item?.images)
    ? item.images
      .filter(img => img?.imageUrl || img?.url)
      .map(img => ({ ...img, imageUrl: img.imageUrl || img.url }))
    : [];
}

function getHistoryThumbnail(item) {
  return isHistoryProject(item)
    ? (item.imageUrl || getHistoryImages(item)[0]?.imageUrl || "")
    : (item?.imageUrl || item?.url || "");
}

function clearAllReferenceImages() {
  referenceImages = [];
  renderThumbGrid();
}

function compactHistoryItem(item) {
  if (!isHistoryProject(item)) return { ...item, imageUrl: item.originalUrl || item.imageUrl };
  const images = getHistoryImages(item).map(img => ({
    ...img,
    imageUrl: img.originalUrl || img.imageUrl,
  }));
  // 项目历史按产品规则不恢复参考图；这里同时兼容清理旧版本曾保存的参考图。
  const panels = Array.isArray(item.panels) ? item.panels.map(p => ({ ...p, references: [] })) : item.panels;
  return {
    ...item,
    images,
    panels,
    imageUrl: images[0]?.imageUrl || item.originalUrl || item.imageUrl,
  };
}

function saveHistory(list) {
  const limit = loadSettings().historyLimit || 100;
  const normalized = list
    .filter(x => x && (isHistoryProject(x) || getHistoryThumbnail(x)))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(normalized));
    void scheduleHistoryBlobPrune();
  } catch (err) {
    const compact = normalized
      .map(compactHistoryItem)
      .slice(0, Math.max(20, Math.floor(limit / 2)));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(compact));
    void scheduleHistoryBlobPrune();
    console.warn("历史项目元数据超出 localStorage 限制，已裁剪旧记录并退回 URL 存储", err);
  }
}

async function saveGenerationRecord(record) {
  if (loadSettings().historyEnabled === false) return;
  await Promise.resolve(record._actualMetaPromise).catch(() => null);
  const { _cachePromise, _cacheKey, _actualMetaPromise, ...persisted } = record;
  persisted.imageUrl = await makeHistoryImageUrl(record.imageUrl, _cachePromise, record.id, _cacheKey);
  const list = loadHistory();
  list.unshift(persisted);
  saveHistory(list);
}

async function saveGenerationProject(project) {
  if (loadSettings().historyEnabled === false) return;
  const sourceImages = Array.isArray(project.images) ? project.images.filter(img => img?.imageUrl) : [];

  const images = [];
  for (const img of sourceImages) {
    await Promise.resolve(img._actualMetaPromise).catch(() => null);
    const panelPrompt = getPanelOnlyPrompt(img, project.globalPrompt || "");
    const { fullPrompt: _fullPrompt, _cachePromise, _cacheKey, _actualMetaPromise, ...imageRecord } = img;
    images.push({
      ...imageRecord,
      prompt: panelPrompt,
      panelPrompt,
      imageUrl: await makeHistoryImageUrl(
        img.imageUrl,
        _cachePromise,
        `${project.id || "project"}_${img.panelId || images.length + 1}`,
        _cacheKey,
      ),
      originalUrl: img.originalUrl || img.imageUrl,
    });
  }

  const first = images[0];
  const record = {
    ...project,
    type: project.type || "comic-project",
    mode: project.mode || "comic",
    prompt: project.globalPrompt || "",
    images,
    imageUrl: first?.imageUrl || "",
    originalUrl: first?.originalUrl || "",
  };
  const list = loadHistory();
  list.unshift(record);
  saveHistory(list);
}

// 重试单图模式的某张图片成功后：删掉它原来那条历史记录，用新结果重新入一条
// （而不是留着旧记录不管、平白多出一条重复记录）。
async function replaceSingleHistoryRecord(oldRecordId, newRecord) {
  if (loadSettings().historyEnabled === false) return;
  await Promise.resolve(newRecord._actualMetaPromise).catch(() => null);
  const { _cachePromise, _cacheKey, _actualMetaPromise, ...persisted } = newRecord;
  const record = {
    ...persisted,
    imageUrl: await makeHistoryImageUrl(newRecord.imageUrl, _cachePromise, newRecord.id, _cacheKey),
  };
  const list = loadHistory();
  const filtered = oldRecordId ? list.filter(item => item.id !== oldRecordId) : list;
  filtered.unshift(record);
  saveHistory(filtered);
}

// 重试漫画分镜里的某一张成功后：原地替换该项目历史记录里对应分镜的图片，
// 不新增记录、不改变项目在历史列表里的位置，旧图彻底不留痕迹。
async function updateComicHistoryPanel(projectId, panelId, record) {
  if (!projectId || loadSettings().historyEnabled === false) return;
  await Promise.resolve(record._actualMetaPromise).catch(() => null);
  const list = loadHistory();
  const project = list.find(item => item.id === projectId && isHistoryProject(item));
  if (!project || !Array.isArray(project.images)) return;
  const idx = project.images.findIndex(img => String(img.panelId || "") === String(panelId));
  if (idx === -1) return;
  const panelPrompt = getPanelOnlyPrompt(record, project.globalPrompt || "");
  project.images[idx] = {
    ...project.images[idx],
    prompt: panelPrompt,
    panelPrompt,
    fullPrompt: record.fullPrompt || project.images[idx].fullPrompt,
    imageUrl: await makeHistoryImageUrl(
      record.imageUrl,
      record._cachePromise,
      `${projectId}_${panelId}`,
      record._cacheKey,
    ),
    originalUrl: record.originalUrl || record.imageUrl,
    retryCount: record.retryCount ?? project.images[idx].retryCount,
    size: record.size || project.images[idx].size,
    billing: record.billing || null,
    usage: record.usage || null,
    provider: record.provider || project.images[idx].provider || "",
    operation: record.operation || project.images[idx].operation || "",
    requested: record.requested || project.images[idx].requested || null,
    actual: record.actual || project.images[idx].actual || null,
    inpaint: record.inpaint || project.images[idx].inpaint || null,
  };
  if (idx === 0) {
    project.imageUrl = project.images[0].imageUrl;
    project.originalUrl = project.images[0].originalUrl;
  }
  saveHistory(list);
}

async function makeHistoryImageUrl(imageUrl, cachedBlob = null, preferredKey = "", generatedCacheKey = "") {
  if (!imageUrl || /^(?:idb|cache):\/\//.test(String(imageUrl))) return imageUrl;
  try {
    let blob = cachedBlob instanceof Blob ? cachedBlob : null;
    if (!blob && cachedBlob) blob = await Promise.resolve(cachedBlob).catch(() => null);
    if (!(blob instanceof Blob)) blob = await imageUrlToBlob(imageUrl);
    if (generatedCacheKey) {
      const key = sanitizeFilePart(generatedCacheKey, "generated");
      if (!(await getGeneratedCacheBlob(key))) await putGeneratedCacheBlob(key, blob);
      return `cache://${key}`;
    }
    const key = sanitizeFilePart(preferredKey || `history_${Date.now()}_${Math.random().toString(16).slice(2)}`, "history");
    await putHistoryBlob(key, blob);
    return `idb://${key}`;
  } catch (err) {
    console.warn("IndexedDB 历史图片缓存失败，尝试退回 data URL", err);
    try {
      const blob = cachedBlob instanceof Blob ? cachedBlob : await imageUrlToBlob(imageUrl);
      return await blobToDataUrl(blob);
    } catch {
      return imageUrl;
    }
  }
}

function formatDateGroup(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return tr("未知日期");
  return date.toLocaleDateString(localeTagForCurrentLanguage(), { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(localeTagForCurrentLanguage(), { hour: "2-digit", minute: "2-digit" });
}

function getFilteredHistory() {
  const q = (dom.historySearch?.value || "").trim().toLowerCase();
  const list = loadHistory().filter(item => isHistoryProject(item) || item?.mode !== "comic");
  if (!q) return list;
  return list.filter(item => {
    const imageText = getHistoryImages(item)
      .flatMap(img => [img.prompt, img.panelPrompt, img.fullPrompt, img.panelId])
      .join(" ");
    const panelText = Array.isArray(item.panels)
      ? item.panels.flatMap(panel => [panel.prompt, panel.panelPrompt, panel.panelId]).join(" ")
      : "";
    return [
      item.title,
      item.prompt,
      item.globalPrompt,
      item.model,
      item.mode,
      item.type,
      item.size,
      item.createdAt,
      item.endpoint,
      imageText,
      panelText,
    ].some(v => String(v || "").toLowerCase().includes(q));
  });
}

function renderHistory() {
  if (!dom.historyList) return;
  const list = getFilteredHistory();
  releaseHistoryPreviewUrls();
  dom.historyList.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = cleanText("noHistory");
    dom.historyList.appendChild(empty);
    return;
  }

  const groups = new Map();
  list.forEach(item => {
    const key = formatDateGroup(item.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  groups.forEach((items, dateLabel) => {
    const group = document.createElement("section");
    group.className = "history-date-group";
    const title = document.createElement("div");
    title.className = "history-date-title";
    title.textContent = `${dateLabel} · ${items.length}`;
    const grid = document.createElement("div");
    grid.className = "history-grid";

    items.forEach(item => grid.appendChild(createHistoryCard(item)));
    group.append(title, grid);
    dom.historyList.appendChild(group);
  });
}

function createHistoryProjectCard(item, images, thumbnail) {
  const card = document.createElement("article");
  card.className = "history-card history-card-project history-project-card";

  const strip = document.createElement("div");
  strip.className = "history-project-strip";
  const previewImages = images.slice(0, 3);
  if (previewImages.length === 0 && thumbnail) previewImages.push({ imageUrl: thumbnail, panelId: "1" });
  previewImages.forEach((image, index) => {
    const thumb = document.createElement("img");
    thumb.alt = `${cleanText("panelLabel")} ${image.panelId || index + 1}`;
    thumb.loading = "lazy";
    thumb.tabIndex = 0;
    thumb.setAttribute("role", "button");
    const source = image.imageUrl || thumbnail;
    const fallback = image.originalUrl || "";
    void setHistoryImageSource(thumb, source, fallback);
    thumb.addEventListener("click", () => void openLightbox(source, fallback));
    thumb.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      void openLightbox(source, fallback);
    });
    strip.appendChild(thumb);
  });
  if (!previewImages.length) {
    const failed = document.createElement("div");
    failed.className = "history-project-empty-preview";
    failed.textContent = `${cleanText("failReason")} · ${item.totalPanels || item.panels?.length || 0}`;
    strip.appendChild(failed);
  }
  if (images.length > previewImages.length) {
    const more = document.createElement("div");
    more.className = "history-project-more";
    more.textContent = `+${images.length - previewImages.length}`;
    strip.appendChild(more);
  }

  const meta = document.createElement("div");
  meta.className = "history-meta";
  const title = document.createElement("div");
  title.className = "history-project-title";
  const projectType = item.mode === "caption" ? cleanText("captionProject") : cleanText("comicProject");
  title.textContent = item.title || `${projectType} · ${images.length}`;
  const sub = document.createElement("div");
  sub.className = "history-sub";
  const totalCost = sumBillingCny(images);
  sub.textContent = `${formatTime(item.createdAt)} · ${projectType} · ${images.length} · ${item.model || "-"}${totalCost !== null ? ` · ${formatCny(totalCost)}` : ""}`;

  const details = document.createElement("details");
  details.className = "history-project-details";
  const summary = document.createElement("summary");
  summary.textContent = cleanText("viewPrompts");
  const promptList = document.createElement("div");
  promptList.className = "history-project-prompts";

  const addPromptBlock = (label, text) => {
    const block = document.createElement("div");
    block.className = "history-prompt-block";
    const strong = document.createElement("strong");
    strong.textContent = label;
    const body = document.createElement("span");
    body.className = "history-prompt-text";
    body.textContent = text || cleanText("noPrompt");
    block.append(strong, body);
    addPromptCollapseToggle(block, body, body.textContent);
    promptList.appendChild(block);
  };

  if (item.globalPrompt) addPromptBlock(cleanText("globalPromptLabel"), item.globalPrompt);
  const panels = Array.isArray(item.panels) && item.panels.length ? item.panels : images;
  panels.forEach((panel, index) => {
    const panelId = panel.panelId || images[index]?.panelId || index + 1;
    const text = getPanelOnlyPrompt({
      panelPrompt: panel.panelPrompt || images[index]?.panelPrompt || "",
      prompt: panel.prompt || images[index]?.prompt || "",
      fullPrompt: panel.fullPrompt || images[index]?.fullPrompt || "",
    }, item.globalPrompt || "");
    addPromptBlock(`${cleanText("panelLabel")} ${panelId}`, text);
  });
  details.append(summary, promptList);
  meta.append(title, sub, details);

  const actions = document.createElement("div");
  actions.className = "history-actions";
  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "btn btn-xs";
  restore.textContent = cleanText("restoreProject");
  restore.addEventListener("click", () => restoreHistoryItem(item));
  const download = document.createElement("button");
  download.type = "button";
  download.className = "btn btn-xs";
  download.textContent = cleanText("downloadProject");
  download.disabled = images.length === 0;
  download.addEventListener("click", () => downloadHistoryProject(item));
  actions.append(restore, download);

  card.append(strip, meta, actions);
  return card;
}

function createHistoryCard(item) {
  const project = isHistoryProject(item);
  const images = getHistoryImages(item);
  const thumbnail = getHistoryThumbnail(item);
  if (project) return createHistoryProjectCard(item, images, thumbnail);

  const card = document.createElement("article");
  card.className = "history-card";
  const img = document.createElement("img");
  img.alt = item.prompt || "历史图片";
  img.loading = "lazy";
  img.tabIndex = 0;
  img.setAttribute("role", "button");
  void setHistoryImageSource(img, thumbnail, item.originalUrl || "");
  img.addEventListener("click", () => void openLightbox(thumbnail, item.originalUrl || ""));
  img.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void openLightbox(thumbnail, item.originalUrl || "");
  });

  const meta = document.createElement("div");
  meta.className = "history-meta";
  const prompt = document.createElement("div");
  prompt.className = "history-prompt";
  const promptText = item.prompt || cleanText("noPrompt");
  prompt.textContent = promptText;
  prompt.title = item.prompt || "";
  const sub = document.createElement("div");
  sub.className = "history-sub";
  sub.textContent = `${formatTime(item.createdAt)} · ${item.model || "-"} · ${item.size || "-"}${item.billing ? ` · ${formatCny(item.billing.cny)}` : ""}`;
  meta.append(prompt);
  const longPrompt = prompt.title || promptText;
  addPromptCollapseToggle(meta, prompt, longPrompt);
  meta.append(sub);

  const actions = document.createElement("div");
  actions.className = "history-actions";
  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "btn btn-xs";
  restore.textContent = ({ "zh-CN": "恢复", "zh-Hant": "恢復", en: "Restore", ja: "復元", ko: "복원" })[currentLanguage] || "恢复";
  restore.addEventListener("click", () => restoreHistoryItem(item));
  const download = document.createElement("button");
  download.type = "button";
  download.className = "btn btn-xs";
  download.textContent = cleanText("download");
  download.addEventListener("click", () => {
    downloadImage(item.imageUrl, item.panelId || item.id, item.originalUrl || "");
  });
  actions.append(restore, download);

  card.append(img, meta, actions);
  return card;
}

async function downloadHistoryProject(item) {
  const images = getHistoryImages(item);
  if (!images.length) {
    showStatus(cleanText("noImagesToExport"), "error");
    return;
  }
  setDownloadProgress(2, cleanText("preparingZip"));
  try {
    const zipBlob = await buildImagesZip(images.map((image, index) => ({
      ...image,
      url: image.imageUrl || image.url,
      panelId: image.panelId || index + 1,
    })), {
      folder: sanitizeFilePart(item.title || (item.mode === "caption" ? "caption-project" : "comic-project"), item.mode === "caption" ? "caption-project" : "comic-project"),
      mode: item.mode || "comic",
      title: item.title || cleanText(item.mode === "caption" ? "captionProject" : "comicProject"),
      createdAt: item.createdAt,
      model: item.model || "",
      globalPrompt: item.globalPrompt || "",
    });
    const filename = `${sanitizeFilePart(item.title || (item.mode === "caption" ? "caption-project" : "comic-project"), item.mode === "caption" ? "caption-project" : "comic-project")}.zip`;
    await saveOrDownloadBlob(zipBlob, filename, "application/zip", "zips");
    setDownloadProgress(100, `${cleanText("zipSaved")}: ${filename}`, true);
    showStatus(`${cleanText("zipSaved")}: ${filename}`, "success");
  } catch (err) {
    hideDownloadProgress();
    showStatus(`${cleanText("exportFailed")}: ${err.message || err}`, "error");
  }
}

function applyHistoryPanelSize(row, size) {
  const match = String(size || "").match(/^(\d{2,5})x(\d{2,5})$/);
  if (!match) return;
  const width = row.querySelector(".panel-size-w");
  const height = row.querySelector(".panel-size-h");
  if (width) width.value = match[1];
  if (height) height.value = match[2];
}

function restoreHistoryProjectEditor(item, images) {
  if (item.mode === "caption") {
    switchMode("caption");
    clearAllReferenceImages();
    dom.prompt.value = item.globalPrompt || item.prompt || "";
    dom.captionTbody.innerHTML = "";
    captionRowCounter = 0;

    const sourceRows = Array.isArray(item.panels) && item.panels.length ? item.panels : images;
    sourceRows.forEach((panel, index) => {
      const matchingImage = images.find(img => String(img.panelId || "") === String(panel.panelId || index + 1)) || images[index] || {};
      const rowData = {
        ...matchingImage,
        ...panel,
        panelPrompt: panel.panelPrompt || matchingImage.panelPrompt || "",
        prompt: panel.prompt || matchingImage.prompt || "",
        fullPrompt: panel.fullPrompt || matchingImage.fullPrompt || "",
      };
      const row = addCaptionRow();
      const captionInput = row.querySelector(".caption-text");
      if (captionInput) captionInput.value = getPanelOnlyPrompt(rowData, item.globalPrompt || "");
    });

    if (dom.captionTbody.children.length === 0) addCaptionRow();
    refreshLocalizedUiState();
    return;
  }

  switchMode("comic");
  clearAllReferenceImages();
  dom.prompt.value = item.globalPrompt || item.prompt || "";
  dom.panelTbody.innerHTML = "";
  panelCounter = 0;

  const sourcePanels = Array.isArray(item.panels) && item.panels.length ? item.panels : images;
  sourcePanels.forEach((panel, index) => {
    const matchingImage = images.find(img => String(img.panelId || "") === String(panel.panelId || index + 1)) || images[index] || {};
    const panelData = {
      ...matchingImage,
      ...panel,
      panelPrompt: panel.panelPrompt || matchingImage.panelPrompt || "",
      prompt: panel.prompt || matchingImage.prompt || "",
      fullPrompt: panel.fullPrompt || matchingImage.fullPrompt || "",
    };
    const row = addPanelRow();
    const promptInput = row.querySelector("textarea");
    if (promptInput) promptInput.value = getPanelOnlyPrompt(panelData, item.globalPrompt || "");
    applyHistoryPanelSize(row, panel.size || matchingImage.size || item.size || "");
    const retryInput = row.querySelector(".panel-retry-count");
    const retryValue = panel.retryCount ?? matchingImage.retryCount ?? item.retryCount;
    if (retryInput && retryValue !== undefined && retryValue !== null && retryValue !== "") {
      retryInput.value = String(clampRetryCount(retryValue, getGlobalRetryCount()));
    }
  });

  if (dom.panelTbody.children.length === 0) addPanelRow();
  syncPanelCountInput();
  refreshLocalizedUiState();
}

function restoreHistoryItem(item) {
  dom.resultGrid.classList.remove("hidden");
  dom.emptyState.classList.add("hidden");
  dom.resultToolbar.classList.remove("hidden");
  clearAllReferenceImages();

  if (isHistoryProject(item)) {
    const images = getHistoryImages(item);
    restoreHistoryProjectEditor(item, images);
    dom.resultGrid.innerHTML = "";
    generatedImageUrls = [];
    currentComicHistoryId = item.id || null; // 恢复后重试某个分镜时，原地更新这条历史记录
    updateFailedRetryTools();
    images.forEach((image, index) => {
      const card = document.createElement("div");
      card.className = "result-item";
      const panelId = image.panelId || index + 1;
      const data = { data: [{ url: image.imageUrl, originalUrl: image.originalUrl || "" }] };
      const panelPrompt = getPanelOnlyPrompt(image, item.globalPrompt || "");
      const fullPrompt = image.fullPrompt || (item.globalPrompt ? `${item.globalPrompt}\n\n${panelPrompt}` : panelPrompt);
      replacePlaceholder(card, panelId, data, panelPrompt, {
        skipHistory: true,
        recordPrompt: panelPrompt,
        fullPrompt,
        size: image.size || item.size,
        billing: image.billing || null,
        usage: image.usage || null,
        retryContext: {
          mode: item.mode || "comic",
          globalPrompt: item.globalPrompt || "",
          panelPrompt,
          prompt: fullPrompt,
          fullPrompt,
          size: image.size || item.size,
          retryCount: image.retryCount ?? item.retryCount ?? getGlobalRetryCount(),
        },
      });
      dom.resultGrid.appendChild(card);
    });
    updateFailedRetryTools();
    closeModal(dom.historyModal);
    showStatus(item.mode === "caption" ? `已恢复嵌字项目：${images.length} 张图片` : `已恢复漫画项目：${images.length} 张图片`, "success");
    return;
  }

  const card = document.createElement("div");
  card.className = "result-item";
  const data = { data: [{ url: item.imageUrl, originalUrl: item.originalUrl || "" }] };
  replacePlaceholder(card, item.panelId || "历史", data, item.prompt || "", {
    skipHistory: true,
    size: item.size,
    billing: item.billing || null,
    usage: item.usage || null,
    retryContext: {
      mode: item.mode || currentMode,
      prompt: item.prompt || "",
      size: item.size,
      retryCount: item.retryCount ?? getGlobalRetryCount(),
    },
  });
  card._historyRecordId = item.id || null; // 恢复后重试时，原地替换这条历史记录而不是新增一条
  dom.resultGrid.prepend(card);
  updateFailedRetryTools();
  closeModal(dom.historyModal);
  showStatus("已从历史记录恢复到结果区", "success");
}

dom.historyBtn?.addEventListener("click", () => {
  renderHistory();
  openModal(dom.historyModal);
});
dom.closeHistory?.addEventListener("click", () => closeModal(dom.historyModal));
dom.historyModal?.addEventListener("click", e => { if (e.target === dom.historyModal) closeModal(dom.historyModal); });
dom.refreshHistory?.addEventListener("click", renderHistory);
dom.historySearch?.addEventListener("input", renderHistory);
dom.clearHistory?.addEventListener("click", async () => {
  if (!(await askConfirm("确定清空全部生图记录？"))) return;
  saveHistory([]);
  await clearHistoryBlobStore();
  renderHistory();
  showStatus("历史记录已清空", "info");
});

// ═══════════════════════════════════════════════════════════
//  下载 & 复制
// ═══════════════════════════════════════════════════════════

const nativeDownload = (() => {
  let seq = 1;
  let transferSeq = 1;
  const pending = new Map();
  const dirs = { images: "", zips: "" };
  const WINDOWS_FILE_CHUNK_SIZE = 256 * 1024;

  function available() {
    return typeof FlutterDownload !== "undefined" && FlutterDownload.postMessage;
  }

  function request(action, payload = {}, timeoutMs = 120000, signal = null) {
    if (!available()) return Promise.reject(new Error("native bridge unavailable"));
    if (signal?.aborted) return Promise.reject(createAbortError());
    const id = `req_${Date.now()}_${seq++}`;
    return new Promise((resolve, reject) => {
      let timer = null;
      let abortHandler = null;
      const cancelNativeFetch = () => {
        if (action !== "nativeFetch" || !available()) return;
        try {
          FlutterDownload.postMessage(JSON.stringify({
            id: "",
            action: "cancelNativeFetch",
            targetId: id,
          }));
        } catch (err) {
          console.warn("Cannot notify native request cancellation", err);
        }
      };
      const cleanup = () => {
        if (timer !== null) clearTimeout(timer);
        if (abortHandler && signal) signal.removeEventListener("abort", abortHandler);
      };
      pending.set(id, { resolve, reject, cleanup });
      // timeoutMs === null 表示调用方明确要求不设超时（目前只有生图请求这么用，见 smartFetch()）。
      // 注意：这里不能用 setTimeout(fn, Infinity) 来表示"不超时"——delay 内部会被转成 32 位有符号
      // 整数，超出 2^31-1 毫秒（约 24.8 天）会溢出，绝大多数引擎（包括 V8）会把它当成 0/极小值
      // 处理，导致"传 Infinity"实际效果是几乎立刻超时，跟意图完全相反。所以"不设超时"必须是
      // "压根不创建这个计时器"，不是"创建一个超大延迟的计时器"。
      if (timeoutMs !== null) {
        timer = setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          cleanup();
          cancelNativeFetch();
          // 这条消息以前写死"Android"，但这个桥接函数在 Windows/Android 上是同一份代码、同一个
          // 调用路径，Windows 端超时也会走到这里——之前的措辞会让 Windows 用户误以为是安卓端才有
          // 的问题。改成不带平台名、带上具体 action，方便定位到底是哪个操作卡住了。
          reject(new Error(`原生功能调用超时（${action}），请重试`));
        }, timeoutMs);
      }
      abortHandler = () => {
        if (!pending.has(id)) return;
        pending.delete(id);
        cleanup();
        cancelNativeFetch();
        reject(createAbortError());
      };
      signal?.addEventListener("abort", abortHandler, { once: true });
      try {
        FlutterDownload.postMessage(JSON.stringify({ id, action, ...payload }));
      } catch (err) {
        pending.delete(id);
        cleanup();
        reject(err);
      }
    });
  }

  window.AiGenAndroidBridge = {
    resolve(id, result) {
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      item.cleanup?.();
      item.resolve(result);
    },
    reject(id, message) {
      const item = pending.get(id);
      if (!item) return;
      pending.delete(id);
      item.cleanup?.();
      item.reject(new Error(message || "原生操作失败"));
    },
    setDirs(nextDirs) {
      dirs.images = nextDirs?.images || "";
      dirs.zips = nextDirs?.zips || "";
      updateDirLabels();
    },
    onAppPaused() {
      appWasBackgrounded = true;
    },
    onAppResumed() {
      if (!appWasBackgrounded) return;
      appWasBackgrounded = false;
      updateDirLabels();
      if (!dom.historyModal?.classList.contains("hidden")) renderHistory();
      showStatus("已从后台返回，页面状态已刷新", "info");
    }
  };

  return {
    available,
    dirs,
    chooseDir(kind) { return request("chooseDir", { kind }, 15 * 60 * 1000); },
    nativeFetch(url, method, headers, body) {
      return request("nativeFetch", withDesktopProxyPayload({ url, method, headers, body }));
    },
    nativeFetchPayload(payload, timeoutMs, signal) {
      return request("nativeFetch", withDesktopProxyPayload(payload), timeoutMs, signal);
    },
    async nativeFetchBlob(url) {
      const meta = await request("nativeFetch", withDesktopProxyPayload({
        url,
        method: "GET",
        responseType: "chunkedBase64",
      }));
      const transferId = String(meta?.transferId || "");
      if (!transferId) throw new Error("原生图片读取未返回传输编号");
      const byteLength = Math.max(0, Number(meta?.byteLength) || 0);
      const chunkSize = Math.max(1, Math.min(192 * 1024, Number(meta?.chunkSize) || 192 * 1024));
      const chunks = [];
      let offset = 0;
      try {
        const status = Number(meta?.status || 0);
        if (status < 200 || status >= 300) return meta;
        while (offset < byteLength) {
          const part = await request("nativeFetchBlobChunk", {
            transferId,
            offset,
            length: Math.min(chunkSize, byteLength - offset),
          });
          const bytes = base64ToBytes(part?.base64 || "");
          const nextOffset = Number(part?.nextOffset);
          if (!bytes.length || !Number.isFinite(nextOffset) || nextOffset <= offset) {
            throw new Error("原生图片分块传输中断");
          }
          chunks.push(bytes);
          offset = nextOffset;
        }
        const headers = meta?.headers || {};
        const type = headers["content-type"] || headers["Content-Type"] || "application/octet-stream";
        return { ...meta, blob: new Blob(chunks, { type }) };
      } finally {
        request("nativeFetchBlobRelease", { transferId }).catch(() => {});
      }
    },
    openExternal(url) {
      return request("openExternal", { url });
    },
    async saveFile(kind, fileName, mimeType, base64, folder = "") {
      const encoded = String(base64 || "");
      if (!encoded) throw new Error("保存失败：文件内容为空");

      // webview_windows sends bridge messages as JSON strings. A complete ZIP
      // can exceed the practical message size and arrive truncated or empty, so
      // every Windows ZIP (and any other large file) is streamed in bounded,
      // base64-aligned chunks instead of one oversized message.
      if (isNativeWindowsWebview() && (kind === "zips" || encoded.length > WINDOWS_FILE_CHUNK_SIZE)) {
        const transferId = `file_${Date.now()}_${transferSeq++}`;
        await request("saveFileBegin", { transferId, kind, fileName, mimeType, folder });
        try {
          for (let offset = 0; offset < encoded.length; offset += WINDOWS_FILE_CHUNK_SIZE) {
            await request("saveFileChunk", {
              transferId,
              chunk: encoded.slice(offset, offset + WINDOWS_FILE_CHUNK_SIZE),
            });
          }
          return await request("saveFileCommit", { transferId }, 15 * 60 * 1000);
        } catch (err) {
          request("saveFileAbort", { transferId }).catch(() => {});
          throw err;
        }
      }
      return request("saveFile", { kind, fileName, mimeType, base64: encoded, folder });
    },
    downloadUpdate(url, fileName, install, platform, expectedSha256 = "") {
      return request("downloadUpdate", withDesktopProxyPayload({
        url,
        fileName,
        install: !!install,
        platform,
        expectedSha256,
      }), null);
    },
    getInstallDir() { return request("getInstallDir", {}); },
    chooseInstallDir() { return request("chooseInstallDir", {}, 15 * 60 * 1000); },
    resetInstallDir() { return request("resetInstallDir", {}); },
    saveSecret(key, value) { return request("saveSecret", { key, value }); },
    loadSecret(key) { return request("loadSecret", { key }); },
    deleteSecret(key) { return request("deleteSecret", { key }); },
  };
})();

document.body.classList.toggle("native-download", nativeDownload.available());
document.body.classList.toggle("no-native-download", !nativeDownload.available());
document.body.classList.toggle("windows-native", isNativeWindowsWebview());
document.body.classList.toggle("desktop-native", isNativeDesktopWebview());

let secureStorageMigrationStarted = false;

function migrateApiKeysToSecureStorage() {
  if (!secureStorageBridgeAvailable() || secureStorageMigrationStarted) return;
  secureStorageMigrationStarted = true;
  const current = loadConfig();
  const apis = loadAllApis().map(api => (
    current?.id === api.id && current.apiKey ? { ...api, apiKey: current.apiKey, hasSecureKey: false } : api
  ));
  if (current?.apiKey) saveConfig(current);
  if (apis.some(api => api.apiKey)) saveAllApis(apis);
  if (!dom.apiKey.value && current?.hasSecureKey) applyConfig(current);
}

window.addEventListener("aigen-native-ready", () => {
  migrateApiKeysToSecureStorage();
  // The native marker can arrive after the first paint (notably on iOS/iPadOS).
  // Refresh platform-specific update labels once the reliable platform is known.
  applyLanguage(currentLanguage);
});
migrateApiKeysToSecureStorage();

function shortPathLabel(uri) {
  if (!uri) return "未选择";
  try { return decodeURIComponent(uri).split("/").pop() || uri; }
  catch { return uri; }
}

function updateDirLabels() {
  if (dom.imageDirLabel) dom.imageDirLabel.textContent = shortPathLabel(nativeDownload.dirs.images);
  if (dom.zipDirLabel) dom.zipDirLabel.textContent = shortPathLabel(nativeDownload.dirs.zips);
  if (dom.settingsImageDirLabel) dom.settingsImageDirLabel.textContent = shortPathLabel(nativeDownload.dirs.images);
  if (dom.settingsZipDirLabel) dom.settingsZipDirLabel.textContent = shortPathLabel(nativeDownload.dirs.zips);
}

async function chooseDownloadDir(kind) {
  try {
    if (!nativeDownload.available()) {
      showStatus("当前不是原生软件环境，浏览器会使用默认下载目录", "info");
      return;
    }
    showStatus(kind === "images" ? "正在打开图片目录选择器…" : "正在打开 ZIP 目录选择器…", "info");
    await nativeDownload.chooseDir(kind);
    showStatus(kind === "images" ? "图片下载目录已更新" : "ZIP 下载目录已更新", "success");
  } catch (err) {
    showStatus(`目录选择失败: ${err.message}`, "error");
  }
}

dom.chooseImageDir?.addEventListener("click", () => chooseDownloadDir("images"));
dom.chooseZipDir?.addEventListener("click", () => chooseDownloadDir("zips"));
dom.settingsChooseImageDir?.addEventListener("click", () => chooseDownloadDir("images"));
dom.settingsChooseZipDir?.addEventListener("click", () => chooseDownloadDir("zips"));

// 安装目录只对打包后的原生 Windows exe 有意义（安卓更新是跳 GitHub 发布页，浏览器/PWA 没有
// "安装目录"这个概念），所以整行在 switchMode 之外单独用 isNativeWindowsWebview() 控制显隐，
// 不复用 native-download/no-native-download 这两个"安卓+Windows 共用"的 body class。
async function refreshInstallDirLabel() {
  if (!dom.settingsInstallDirLabel || !isNativeWindowsWebview()) return;
  try {
    const info = await nativeDownload.getInstallDir();
    dom.settingsInstallDirLabel.textContent = info?.installDir || cleanText("notChecked");
    if (dom.settingsResetInstallDir) dom.settingsResetInstallDir.classList.toggle("hidden", !info?.isOverride);
  } catch (err) {
    dom.settingsInstallDirLabel.textContent = cleanText("notChecked");
  }
}

dom.settingsChooseInstallDir?.addEventListener("click", async () => {
  try {
    showStatus("正在打开安装目录选择器…", "info");
    await nativeDownload.chooseInstallDir();
    await refreshInstallDirLabel();
    showStatus(cleanText("installDirUpdated"), "success");
  } catch (err) {
    showStatus(`目录选择失败: ${err.message}`, "error");
  }
});

dom.settingsResetInstallDir?.addEventListener("click", async () => {
  try {
    await nativeDownload.resetInstallDir();
    await refreshInstallDirLabel();
    showStatus(cleanText("installDirResetDone"), "success");
  } catch (err) {
    showStatus(`重置失败: ${err.message}`, "error");
  }
});

if (dom.installDirRow) dom.installDirRow.classList.toggle("hidden", !isNativeWindowsWebview());
if (dom.installDirHint) dom.installDirHint.classList.toggle("hidden", !isNativeWindowsWebview());
refreshInstallDirLabel();
updateDirLabels();

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    appWasBackgrounded = true;
    return;
  }
  window.AiGenAndroidBridge?.onAppResumed?.();
});

function setDownloadProgress(percent, text, done = false) {
  if (!dom.downloadProgress || !dom.downloadProgressFill || !dom.downloadProgressText) return;
  dom.downloadProgress.classList.remove("hidden");
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  dom.downloadProgressFill.style.width = `${safe}%`;
  dom.downloadProgressText.textContent = text || `${safe}%`;
  dom.downloadProgress.classList.toggle("done", !!done);
  if (done) {
    setTimeout(() => dom.downloadProgress?.classList.add("hidden"), 3500);
  }
}

function hideDownloadProgress() {
  dom.downloadProgress?.classList.add("hidden");
  if (dom.downloadProgressFill) dom.downloadProgressFill.style.width = "0%";
  dom.downloadProgress?.classList.remove("done");
}

async function fetchBlobWithProgress(url, onProgress) {
  // In browsers, <img> may display a cross-origin URL while fetch() is blocked by CORS.
  // Reuse smartFetch so a configured api-proxy.js URL also fixes preview reload/export.
  const resp = await smartFetch(url, { nativeTimeoutMs: 120000 });
  if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
  const total = Number(resp.headers.get("content-length")) || 0;
  if (!resp.body || !total) {
    const blob = await resp.blob();
    onProgress?.(100, blob.size, blob.size);
    return blob;
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(Math.round((received / total) * 100), received, total);
  }
  return new Blob(chunks, { type: resp.headers.get("content-type") || "application/octet-stream" });
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Blob 读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Blob 读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function blobToBytes(blob) {
  if (typeof blob?.arrayBuffer === "function") {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return base64ToBytes(await blobToBase64(blob));
}

function base64ToBytes(base64) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeUtf8(value) {
  const text = String(value ?? "");
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
  const encoded = unescape(encodeURIComponent(text));
  const bytes = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) bytes[i] = encoded.charCodeAt(i);
  return bytes;
}

function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) throw new Error("Invalid data URL");
  const mime = match[1] || "application/octet-stream";
  const bytes = match[2] ? base64ToBytes(match[3]) : encodeUtf8(decodeURIComponent(match[3]));
  return new Blob([bytes], { type: mime });
}

async function normalizeImageBlob(blob) {
  if (!(blob instanceof Blob) || blob.size <= 0) throw new Error("图片字节为空");
  const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  let type = "";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) type = "image/png";
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) type = "image/jpeg";
  else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) type = "image/gif";
  else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) type = "image/webp";
  else {
    const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trimStart().toLowerCase();
    if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) type = "image/svg+xml";
  }
  if (!type && String(blob.type || "").toLowerCase().startsWith("image/")) return blob;
  if (!type) throw new Error("下载内容不是有效图片，可能是已过期链接或接口错误页");
  return blob.type === type ? blob : new Blob([blob], { type });
}

async function imageUrlToBlob(url, onProgress) {
  if (String(url).startsWith("cache://")) {
    const cached = await getGeneratedCacheBlob(String(url).slice(8));
    if (!cached) throw new Error("生成图片缓存不存在或已被自动清理");
    const normalized = await normalizeImageBlob(cached);
    onProgress?.(100, normalized.size, normalized.size);
    return normalized;
  }
  if (String(url).startsWith("idb://")) {
    const cached = await getHistoryBlob(String(url).slice(6));
    if (!cached) throw new Error("历史图片缓存不存在或已被清理");
    const normalized = await normalizeImageBlob(cached);
    onProgress?.(100, normalized.size, normalized.size);
    return normalized;
  }
  if (String(url).startsWith("data:")) {
    const blob = await normalizeImageBlob(dataUrlToBlob(url));
    onProgress?.(100, blob.size, blob.size);
    return blob;
  }
  if (nativeDownload.available() && /^https?:/i.test(url)) {
    const result = await nativeDownload.nativeFetchBlob(url);
    const status = Number(result?.status || 0);
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status || "?"}`);
    const headers = result?.headers || {};
    const type = headers["content-type"] || headers["Content-Type"] || "image/png";
    const sourceBlob = result?.blob instanceof Blob
      ? result.blob
      : new Blob([base64ToBytes(result?.base64 || "")], { type });
    const blob = await normalizeImageBlob(sourceBlob);
    onProgress?.(100, blob.size, blob.size);
    return blob;
  }
  return normalizeImageBlob(await fetchBlobWithProgress(url, onProgress));
}

async function imageUrlToBlobWithFallback(url, fallbackUrl = "", onProgress) {
  try {
    return await imageUrlToBlob(url, onProgress);
  } catch (primaryError) {
    const fallback = String(fallbackUrl || "").trim();
    if (!fallback || fallback === String(url || "")) throw primaryError;
    return imageUrlToBlob(fallback, onProgress);
  }
}

function sanitizeFilePart(value, fallback = "item") {
  const clean = String(value || fallback)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return clean || fallback;
}

function makeUniqueArchiveName(name, usedNames) {
  const normalized = String(name || "file").replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const directory = slash >= 0 ? normalized.slice(0, slash + 1) : "";
  const fileName = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  let candidate = normalized;
  let copy = 1;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${directory}${stem}（${copy++}）${extension}`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function formatProjectFolderTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function buildProjectFolderName(mode = currentMode, date = new Date()) {
  const fallback = cleanText(mode === "caption" ? "captionProject" : "comicProject");
  const custom = String(dom.zipFileName?.value || "").trim().replace(/\.zip$/i, "").trim();
  // Keep room for the timestamp so a long custom name cannot trim away the
  // collision-resistant suffix on Windows, Android or Apple platforms.
  const base = sanitizeFilePart(custom || fallback, fallback).slice(0, 38).replace(/[ .-]+$/g, "") || fallback;
  return `${base}_${formatProjectFolderTimestamp(date)}`;
}

function imageExtFromBlob(url, blob) {
  const type = (blob?.type || "").toLowerCase();
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (String(url).startsWith("data:image/jpeg")) return "jpg";
  if (String(url).startsWith("data:image/webp")) return "webp";
  if (String(url).startsWith("data:image/gif")) return "gif";
  return "png";
}

function getZipCrcTable() {
  if (getZipCrcTable.table) return getZipCrcTable.table;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  getZipCrcTable.table = table;
  return table;
}

function crc32(bytes) {
  const table = getZipCrcTable();
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function makeZipBlob(entries) {
  const files = [];
  const central = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  entries.forEach(entry => {
    const nameBytes = encodeUtf8(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    files.push(local, data);

    const header = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0x0800, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, dosTime, true);
    view.setUint16(14, dosDate, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, data.length, true);
    view.setUint32(24, data.length, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint32(42, offset, true);
    header.set(nameBytes, 46);
    central.push(header);
    offset += local.length + data.length;
  });

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...files, ...central, end], { type: "application/zip" });
}

function promptsTextForExport(images, meta = {}) {
  const lines = [];
  lines.push(`${cleanText("appTitle")} Export`);
  lines.push(`Created: ${new Date().toLocaleString()}`);
  if (meta.title) lines.push(`Project: ${meta.title}`);
  if (meta.model) lines.push(`Model: ${meta.model}`);
  if (meta.globalPrompt) lines.push(`\n[${cleanText("globalPromptLabel")}]\n${meta.globalPrompt}`);
  images.forEach((image, index) => {
    lines.push(`\n[${cleanText("panelLabel")} ${image.panelId || index + 1}]`);
    lines.push(getPanelOnlyPrompt(image, meta.globalPrompt || "") || cleanText("noPrompt"));
  });
  return lines.join("\n");
}

async function buildImagesZip(images, meta = {}) {
  const entries = [];
  const usedNames = new Set();
  const exported = [];
  const failures = [];
  const folder = sanitizeFilePart(meta.folder || "images", "images");

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    try {
      setDownloadProgress(8 + Math.round((i / Math.max(images.length, 1)) * 52), `${cleanText("collectingImages")} ${i + 1}/${images.length}`);
      // 优先用生成时抓下来的本地字节：远程生图 URL 可能已被中转站删除（约 2 小时），
      // 只有本地缓存能保证"页面上显示什么，ZIP 里就有什么"。
      let blob = image.blob instanceof Blob ? image.blob : null;
      if (!blob && image.cachePromise) {
        blob = await Promise.resolve(image.cachePromise).catch(() => null);
        if (!(blob instanceof Blob)) blob = null;
      }
      if (!blob) blob = await imageUrlToBlobWithFallback(image.url || image.imageUrl, image.originalUrl || "", pct => {
        const base = 8 + Math.round((i / Math.max(images.length, 1)) * 52);
        setDownloadProgress(Math.min(60, base + Math.round((pct || 0) * 0.2)), `${cleanText("collectingImages")} ${i + 1}/${images.length}`);
      });
      const bytes = await blobToBytes(blob);
      const panelId = sanitizeFilePart(image.panelId || i + 1, String(i + 1));
      const ext = imageExtFromBlob(image.url || image.imageUrl, blob);
      const filename = makeUniqueArchiveName(`${folder}/panel-${panelId}.${ext}`, usedNames);
      entries.push({ name: filename, data: bytes });
      exported.push({ ...image, filename });
    } catch (err) {
      failures.push(`${image.panelId || i + 1}: ${err.message || err}`);
    }
  }

  entries.push({ name: makeUniqueArchiveName(`${folder}/prompts.txt`, usedNames), data: encodeUtf8(promptsTextForExport(exported.length ? exported : images, meta)) });
  entries.push({
    name: makeUniqueArchiveName(`${folder}/project.json`, usedNames),
    data: encodeUtf8(JSON.stringify({
      title: meta.title || "",
      mode: meta.mode || currentMode,
      createdAt: meta.createdAt || new Date().toISOString(),
      model: meta.model || dom.model?.value?.trim?.() || "",
      globalPrompt: meta.globalPrompt || "",
      images: exported.map(({ filename, panelId, prompt, panelPrompt, size, retryCount }) => {
        const promptOnly = getPanelOnlyPrompt({ prompt, panelPrompt }, meta.globalPrompt || "");
        return { filename, panelId, prompt: promptOnly, panelPrompt: promptOnly, size, retryCount };
      }),
      failures,
    }, null, 2)),
  });
  if (failures.length) entries.push({ name: makeUniqueArchiveName(`${folder}/download-errors.txt`, usedNames), data: encodeUtf8(failures.join("\n")) });
  if (!exported.length && failures.length) throw new Error(failures.join("; "));

  setDownloadProgress(72, cleanText("compressing"));
  return makeZipBlob(entries);
}

async function downloadImage(imageSource, index, fallbackUrl = "") {
  try {
    setDownloadProgress(3, "准备下载图片…");
    // imageSource 可以是生成时缓存的 Blob（远程生图 URL 约 2 小时被删，本地字节才可靠），
    // 也可以是 data:/blob:/https: 字符串。
    const blob = imageSource instanceof Blob
      ? imageSource
      : await imageUrlToBlobWithFallback(imageSource, fallbackUrl, pct => {
          setDownloadProgress(Math.max(5, Math.min(85, pct * 0.85)), `图片下载中 ${pct}%`);
        });
    const knownBase64 = typeof imageSource === "string" && imageSource.startsWith("data:")
      ? imageSource.split(",")[1]
      : "";
    const filename = `panel-${index}.${imageExtFromBlob(imageSource, blob)}`;
    await saveOrDownloadBlob(blob, filename, blob.type || "image/png", "images", knownBase64);
    setDownloadProgress(100, `下载成功：${filename}`, true);
  } catch (err) {
    hideDownloadProgress();
    showStatus(`下载失败: ${err.message || err}`, "error");
    const externalFallback = /^https?:/i.test(String(fallbackUrl || "")) ? fallbackUrl : imageSource;
    if (typeof externalFallback === "string") await openExternalUrl(externalFallback);
  }
}

async function openExternalUrl(url) {
  const target = String(url || "").trim();
  if (!/^https?:\/\//i.test(target)) return false;
  if (nativeDownload.available() && typeof nativeDownload.openExternal === "function") {
    try {
      await nativeDownload.openExternal(target);
      return true;
    } catch (err) {
      console.warn("openExternal failed, falling back to window.open", err);
    }
  }
  const popup = window.open(target, "_blank", "noopener,noreferrer");
  return !!popup;
}

async function saveOrDownloadBlob(blob, filename, mimeType, kind, knownBase64 = "") {
  if (nativeDownload.available()) {
    setDownloadProgress(88, "等待选择/写入目录…");
    const settings = loadSettings();
    const askEveryTime = kind === "zips" ? settings.zipAskEveryTime === true : settings.imageAskEveryTime === true;
    if (askEveryTime || !nativeDownload.dirs[kind]) {
      await nativeDownload.chooseDir(kind);
    }
    setDownloadProgress(94, "正在保存到本地…");
    const base64 = knownBase64 || await blobToBase64(blob);
    await nativeDownload.saveFile(kind, filename, mimeType, base64);
    showStatus(`已保存: ${filename}`, "success");
    return;
  }
  triggerDownload(blob, filename);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function copyImageUrl(dataUrl, originalUrl) {
  const text = originalUrl || dataUrl;
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta);
  }
  showStatus("链接已复制", "success");
}

// ═══════════════════════════════════════════════════════════
//  ZIP 打包下载
// ═══════════════════════════════════════════════════════════

dom.downloadZip.addEventListener("click", downloadAllAsZip);

function getCurrentResultImages() {
  if (!dom.resultGrid) return [];
  return Array.from(dom.resultGrid.querySelectorAll(".result-item"))
    .map((card, index) => {
      if (card._zipImage?.url) {
        return {
          ...card._zipImage,
          blob: card._zipBlob || null,
          cachePromise: card._imageCachePromise || null,
        };
      }
      const img = card.querySelector("img");
      if (!img?.src) return null;
      const isProjectContext = card._retryContext?.mode === "comic" || card._retryContext?.mode === "caption";
      return {
        url: img.src,
        panelId: card._retryContext?.panelId || String(index + 1),
        prompt: isProjectContext
          ? getPanelOnlyPrompt(card._retryContext, card._retryContext?.globalPrompt || "")
          : (card._retryContext?.prompt || img.alt || ""),
        panelPrompt: isProjectContext ? getPanelOnlyPrompt(card._retryContext, card._retryContext?.globalPrompt || "") : "",
        fullPrompt: card._retryContext?.fullPrompt || card._retryContext?.prompt || "",
      };
    })
    .filter(Boolean);
}

dom.clearResults.addEventListener("click", () => {
  stopCurrentGeneration("已取消当前生成并清空结果");
  dom.resultGrid.innerHTML = "";
  dom.resultGrid.classList.add("hidden");
  dom.emptyState.classList.remove("hidden");
  dom.resultToolbar.classList.add("hidden");
  generatedImageUrls = [];
  updateFailedRetryTools();
});

async function downloadAllAsZip() {
  const images = getCurrentResultImages();
  if (images.length === 0) {
    showStatus(cleanText("noImagesToExport"), "error"); return;
  }

  dom.downloadZip.disabled = true;
  setButtonText(dom.downloadZip, "spark", "packaging");
  setDownloadProgress(2, cleanText("preparingZip"));

  try {
    const zipBlob = await buildImagesZip(images.map((image, index) => ({
      ...image,
      panelId: image.panelId || index + 1,
      prompt: image.prompt || "",
    })), {
      folder: currentMode === "comic" ? "comic-project" : currentMode === "caption" ? "caption-project" : "images",
      mode: currentMode,
      title: currentMode === "comic" ? cleanText("comicProject") : currentMode === "caption" ? cleanText("captionProject") : cleanText("appTitle"),
      globalPrompt: getEffectivePrompt(),
      model: dom.model.value.trim(),
    });
    const customName = dom.zipFileName.value.trim();
    const filename = customName ? `${sanitizeFilePart(customName, "images")}.zip` : `ai-images-${Date.now()}.zip`;
    await saveOrDownloadBlob(zipBlob, filename, "application/zip", "zips");

    setDownloadProgress(100, `${cleanText("zipSaved")}: ${filename}`, true);
    showStatus(`${cleanText("zipSaved")}: ${images.length}`, "success");
  } catch (err) {
    hideDownloadProgress();
    showStatus(`${cleanText("exportFailed")}: ${err.message || err}`, "error");
  } finally {
    dom.downloadZip.disabled = false;
    setButtonText(dom.downloadZip, "zip", "downloadZip");
  }
}

dom.saveComicFolder.addEventListener("click", saveProjectResultsToFolder);

async function saveProjectResultsToFolder() {
  if (!nativeDownload.available()) return;
  const images = getCurrentResultImages();
  if (images.length === 0) {
    showStatus(cleanText("noImagesToExport"), "error"); return;
  }

  const isCaption = currentMode === "caption";

  dom.saveComicFolder.disabled = true;
  setButtonText(dom.saveComicFolder, "spark", "savingToFolder");
  setDownloadProgress(2, cleanText("savingToFolder"));

  try {
    if (loadSettings().imageAskEveryTime === true || !nativeDownload.dirs.images) {
      await nativeDownload.chooseDir("images");
    }
    const folder = buildProjectFolderName(isCaption ? "caption" : "comic");
    const failures = [];
    let saved = 0;

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const panelId = sanitizeFilePart(image.panelId || i + 1, String(i + 1));
      try {
        setDownloadProgress(4 + Math.round((i / Math.max(images.length, 1)) * 90), `${cleanText("collectingImages")} ${i + 1}/${images.length}`);
        // 与 buildImagesZip 相同的容错取字节顺序：生成时缓存的字节最可靠，远程 URL 可能已过期。
        let blob = image.blob instanceof Blob ? image.blob : null;
        if (!blob && image.cachePromise) {
          blob = await Promise.resolve(image.cachePromise).catch(() => null);
          if (!(blob instanceof Blob)) blob = null;
        }
        if (!blob) blob = await imageUrlToBlob(image.url || image.imageUrl);
        const ext = imageExtFromBlob(image.url || image.imageUrl, blob);
        const base64 = await blobToBase64(blob);
        await nativeDownload.saveFile("images", `${isCaption ? "image" : "panel"}-${panelId}.${ext}`, blob.type || "image/png", base64, folder);
        saved++;
      } catch (err) {
        failures.push(`${image.panelId || i + 1}: ${err.message || err}`);
      }
    }

    if (saved === 0) throw new Error(failures.join("; ") || cleanText("exportFailed"));
    setDownloadProgress(100, `${cleanText("folderSaved")}: ${folder}`, true);
    showStatus(
      failures.length ? `${cleanText("folderSaved")}: ${saved}/${images.length}` : `${cleanText("folderSaved")}: ${folder}`,
      failures.length ? "error" : "success"
    );
  } catch (err) {
    hideDownloadProgress();
    showStatus(`${cleanText("exportFailed")}: ${err.message || err}`, "error");
  } finally {
    dom.saveComicFolder.disabled = false;
    setButtonText(dom.saveComicFolder, "folder", "saveToFolder");
  }
}

// ═══════════════════════════════════════════════════════════
//  灯箱
// ═══════════════════════════════════════════════════════════

async function openLightbox(imageUrl, fallbackUrl = "") {
  const overlay = document.createElement("div");
  overlay.className = "lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.tabIndex = -1;
  const img = document.createElement("img");
  let objectUrl = "";
  if (/^(?:idb|cache):\/\//.test(String(imageUrl || ""))) {
    try {
      const blob = String(imageUrl).startsWith("cache://")
        ? await getGeneratedCacheBlob(String(imageUrl).slice(8))
        : await getHistoryBlob(String(imageUrl).slice(6));
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
      } else if (fallbackUrl) {
        img.src = fallbackUrl;
      } else {
        throw new Error("历史图片缓存不存在");
      }
    } catch (err) {
      showStatus(err.message || "历史图片加载失败", "error");
      return;
    }
  } else {
    img.src = imageUrl;
  }
  overlay.appendChild(img);
  const close = () => {
    overlay.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    document.removeEventListener("keydown", onKey);
    updateBodyScrollLock();
  };
  overlay.addEventListener("click", close);
  document.body.appendChild(overlay);
  updateBodyScrollLock();
  overlay.focus();
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
}

// ═══════════════════════════════════════════════════════════
//  生成按钮入口
// ═══════════════════════════════════════════════════════════

dom.generateBtn.addEventListener("click", () => {
  if (dom.generateBtn.classList.contains("is-cancel")) {
    stopCurrentGeneration("已取消生成");
    return;
  }
  if (currentMode === "comic") generateComic();
  else if (currentMode === "caption") generateCaptions();
  else generateSingle();
});

dom.prompt.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    dom.generateBtn.click();
  }
});

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  navigator.serviceWorker.register("sw.js").catch(err => {
    console.warn("Service worker registration skipped:", err);
  });
}

// 启动时静默检测一次更新；如果有新版本，弹窗询问是否立即更新（不打扰用户的话直接取消即可）。
async function checkForUpdatesOnLaunch() {
  try {
    let state = {};
    try { state = JSON.parse(localStorage.getItem(UPDATE_CHECK_STATE_KEY) || "{}"); } catch {}
    if (Date.now() - Number(state.lastCheckedAt || 0) < UPDATE_CHECK_INTERVAL_MS) return;
    const info = await checkForUpdates({ silent: true });
    if (!info?.isNewer) return;
    if (state.dismissedVersion === info.latest) return;
    const message = `${interpolate(cleanText("updateAvailable"), { version: `v${info.latest}` })}\n${cleanText("updateNowPrompt")}`;
    const shouldUpdate = await askConfirm(message);
    if (shouldUpdate) {
      await downloadLatestUpdate(true);
    } else {
      localStorage.setItem(UPDATE_CHECK_STATE_KEY, JSON.stringify({
        ...state,
        lastCheckedAt: Date.now(),
        dismissedVersion: info.latest,
      }));
    }
  } catch (err) {
    console.warn("Startup update check failed:", err);
  }
}

function recordApplicationStartupError(error) {
  const message = String(error?.message || error || "Unknown startup error");
  if (!Array.isArray(window.__AI_GEN_STARTUP_ERRORS)) window.__AI_GEN_STARTUP_ERRORS = [];
  window.__AI_GEN_STARTUP_ERRORS.push(message);
  if (window.__AI_GEN_STARTUP_ERRORS.length > 10) window.__AI_GEN_STARTUP_ERRORS.shift();
  return message;
}

function applyTemporaryStartupConfig() {
  // Do not call saveConfig/clearConfig here. A failed restore must never alter
  // the user's saved API profiles or their secure-storage keys.
  applyApiProvider("custom", { forceEndpoint: true });
  dom.apiEndpoint.value = "";
  dom.apiKey.value = "";
  dom.model.value = "";
  dom.proxyEndpoint.value = "";
  dom.savedApis.value = "";
  customSelects.savedApis?.syncLabel();
  updateApiQuickState();
}

function restoreSavedConfigurationOnStartup() {
  const config = loadConfig();
  applyConfig(config);
  if (!config.endpoint) dom.apiEndpoint.placeholder = GRSAI_API_ENDPOINT;
  if (!config.model) dom.model.placeholder = "gpt-image-2";
  renderSavedApis();
  if (apiProfileRepairNotice?.length) {
    const repairedNames = [...apiProfileRepairNotice];
    apiProfileRepairNotice = null;
    setTimeout(() => showStatus(apiProfileRepairMessage(repairedNames), "error"), 150);
  }
  if (config?.id) {
    const idx = findSavedApiIndex(config.id, loadAllApis());
    if (idx >= 0) {
      dom.savedApis.value = String(idx);
      customSelects.savedApis?.syncLabel();
    }
  }
  dom.configSection.open = false;
  updateApiQuickState();
}

function initializeApplication() {
  let recoverableStartupError = "";
  try {
    // This must remain at the end of the module. applyConfig may use model and
    // pricing constants declared later in app.js.
    restoreSavedConfigurationOnStartup();
  } catch (error) {
    recoverableStartupError = recordApplicationStartupError(error);
    console.warn("Saved configuration restore failed; starting with temporary defaults.", error);
    applyTemporaryStartupConfig();
  }

  initI18n();
  registerServiceWorker();
  initManualWheelScrollFix();
  setTimeout(() => {
    void cleanupGeneratedImageCache().catch(err => console.warn("启动时清理生成图片缓存失败", err));
  }, 15000);
  updateOfficialCostSummary();
  if ((dom.apiProvider?.value || inferApiProvider(dom.apiEndpoint?.value || "")) === "official") {
    setTimeout(() => { void refreshUsdCnyRate({ force: false, announce: false }); }, 500);
  }
  setTimeout(() => { void checkForUpdatesOnLaunch(); }, 1200);
  window.__AI_GEN_APP_READY = true;
  window.dispatchEvent(new CustomEvent("ai-generator-ready"));

  if (recoverableStartupError) {
    setTimeout(() => showStatus(`已跳过无法恢复的启动配置：${recoverableStartupError}`, "error"), 0);
  }
}

try {
  initializeApplication();
} catch (error) {
  const message = recordApplicationStartupError(error);
  console.error("Application startup failed.", error);
  const status = dom.status || document.querySelector("#status");
  if (status) {
    status.textContent = `程序初始化失败：${message}`;
    status.classList.remove("hidden", "success");
    status.classList.add("error");
  }
}
