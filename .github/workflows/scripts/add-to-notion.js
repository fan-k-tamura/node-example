const { Client } = require('@notionhq/client');
const https = require('https');

// Notion APIクライアントの初期化
const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

// GitHubリリース情報の取得
const releaseTag = process.env.GITHUB_RELEASE_TAG;
const releaseName = process.env.GITHUB_RELEASE_NAME || releaseTag;
const releaseUrl = process.env.GITHUB_RELEASE_URL;
const releaseBody = process.env.GITHUB_RELEASE_BODY || '';
const repository = process.env.GITHUB_REPO;
const githubToken = process.env.GITHUB_TOKEN;

// バージョン文字列からバージョン番号を抽出する関数
function parseVersion(versionString) {
  const match = versionString.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
  };
}

// 現在のバージョンと前のバージョンを比較して種別を判定する関数
function compareVersions(currentVersion, previousVersion) {
  if (!previousVersion) return 'その他'; // 前のバージョンがない場合

  if (currentVersion.major > previousVersion.major) {
    return 'メジャー';
  } else if (currentVersion.minor > previousVersion.minor) {
    return 'マイナー';
  } else if (currentVersion.patch > previousVersion.patch) {
    return 'パッチ';
  } else {
    return 'その他';
  }
}

// GitHub API を使って前回のリリースを取得する関数
function getPreviousReleaseTag() {
  return new Promise((resolve, reject) => {
    const [owner, repo] = repository.split('/');
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/releases`,
      method: 'GET',
      headers: {
        'User-Agent': 'GitHub-Notion-Integration',
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': githubToken ? `token ${githubToken}` : undefined
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const releases = JSON.parse(data);
          // 現在のリリースを除外して、直前のリリースを取得
          const currentReleaseIndex = releases.findIndex(release => release.tag_name === releaseTag);
          const previousRelease = releases[currentReleaseIndex + 1]; // 配列は最新順

          if (previousRelease) {
            resolve(previousRelease.tag_name);
          } else {
            resolve(null);
          }
        } catch (error) {
          console.error('Error parsing GitHub API response:', error);
          resolve(null);
        }
      });
    });

    req.on('error', (error) => {
      console.error('Error fetching releases from GitHub API:', error);
      resolve(null);
    });

    req.end();
  });
}

// リリースタグから種別（メジャー、マイナー、パッチ）を判定する関数
async function determineReleaseType(tag) {
  // 現在のバージョンを解析
  const currentVersion = parseVersion(tag);
  if (!currentVersion) return 'その他';

  try {
    // 前回のリリースタグを取得
    const previousReleaseTag = await getPreviousReleaseTag();
    console.log(`Previous release tag: ${previousReleaseTag}`);

    if (previousReleaseTag) {
      const previousVersion = parseVersion(previousReleaseTag);
      if (previousVersion) {
        return compareVersions(currentVersion, previousVersion);
      }
    }

    // 前回のリリースがない場合や解析できない場合は、バージョン番号から推測
    if (currentVersion.major > 0 && currentVersion.minor === 0 && currentVersion.patch === 0) {
      return 'メジャー';
    } else if (currentVersion.patch === 0) {
      return 'マイナー';
    } else {
      return 'パッチ';
    }
  } catch (error) {
    console.error('Error determining release type:', error);
    return 'その他';
  }
}

async function addReleaseToNotion() {
  try {
    // データベースIDをログに出力（機密情報なので最初と最後の数文字のみ）
    const dbId = process.env.NOTION_DATABASE_ID || '';
    const maskedDbId = dbId.length > 8
      ? `${dbId.substring(0, 4)}...${dbId.substring(dbId.length - 4)}`
      : 'not set';
    console.log(`Using Notion database ID: ${maskedDbId}`);

    // APIキーが設定されているか確認
    if (!process.env.NOTION_API_KEY) {
      throw new Error('NOTION_API_KEY environment variable is not set');
    }

    // リリースタグから種別を判定
    const releaseType = await determineReleaseType(releaseTag);
    console.log(`Determined release type: ${releaseType}`);

    // リリースノートをMarkdownブロックに変換
    const contentBlocks = [];

    // リリースノートを複数の段落に分割
    const paragraphs = releaseBody.split('\n\n');

    for (const paragraph of paragraphs) {
      if (paragraph.trim() === '') continue;

      contentBlocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: paragraph,
              },
            },
          ],
        },
      });
    }

    try {
      // データベース情報を取得（プロパティ構造の確認用）
      console.log('Fetching database information...');
      const database = await notion.databases.retrieve({
        database_id: process.env.NOTION_DATABASE_ID
      });

      console.log('Database info:', JSON.stringify({
        id: database.id,
        properties: Object.keys(database.properties)
      }, null, 2));

      // データベースの作成リクエスト
      const createPageRequest = {
        parent: {
          database_id: process.env.NOTION_DATABASE_ID,
        },
        properties: {
          'Version': {
            title: [
              {
                text: {
                  content: releaseName,
                },
              },
            ],
          },
          'リリース日': {
            date: {
              start: new Date().toISOString(),
            },
          },
          '種別': {
            select: {
              name: releaseType || 'その他', // 種別が判定できない場合は「その他」
            },
          },
          'URL': {
            url: releaseUrl,
          },
        }
      };

      // ページコンテンツの作成
      createPageRequest.children = [
        {
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: 'GitHub リリース情報',
                },
              },
            ],
          },
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: `リポジトリ: ${repository}`,
                },
              },
            ],
          },
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: `バージョン: ${releaseTag}`,
                },
              },
            ],
          },
        },
        {
          object: 'block',
          type: 'divider',
          divider: {}
        },
        {
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: 'リリースノート',
                },
              },
            ],
          },
        },
        ...contentBlocks
      ];

      // ページを作成
      const response = await notion.pages.create(createPageRequest);
      console.log('Successfully added release to Notion!');
      console.log(`Page URL: ${response.url}`);
    } catch (apiError) {
      if (apiError.code === 'object_not_found') {
        console.error(`Notion database with ID ${maskedDbId} not found.`);
        console.error('Please check:');
        console.error('1. The database ID is correct');
        console.error('2. Your Notion integration has access to this database:');
        console.error('   - Open your database in Notion');
        console.error('   - Click the "..." menu in the top-right corner');
        console.error('   - Select "Connections"');
        console.error('   - Add your integration to the "Connections" list');
        console.error('3. The database still exists in your Notion workspace');
      }
      throw apiError;
    }
  } catch (error) {
    console.error('Error adding release to Notion:');
    console.error(error);
    process.exit(1);
  }
}

// スクリプト実行
addReleaseToNotion();
