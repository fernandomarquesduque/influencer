/**
 * Métricas derivadas e BI 100% baseados em dados do Instagram (GraphQL/Polaris).
 * Nada de CPM, ROI ou dados externos — apenas followers, likes, comments, views, timestamps, hashtags, location, product_type.
 */

export interface PostForBi {
  metrics?: { likes?: number; comments?: number; view_count?: number | null; video_duration?: number | null };
  content?: { hashtags?: string[] };
  content_type?: string;
  post?: { taken_at?: number };
  [key: string]: unknown;
}

export interface EngagementSlice {
  posts_count: number;
  total_likes: number;
  total_comments: number;
  total_views: number;
  avg_likes: number;
  avg_comments: number;
  avg_views: number;
  engagement_rate: number;
}

export interface InstagramBi {
  /** Alcance relativo: avg_views / followers — audiência ativa vs inflada. */
  reach_ratio: number;
  /** comments / (likes + comments) — profundidade da comunidade. */
  conversation_rate: number;
  /** total_likes / total_views (quando views > 0) — qualidade da audiência. */
  like_view_ratio: number | null;
  /** total_comments / followers. */
  comments_per_follower: number;
  /** Engajamento por tipo de mídia (post, reel, tagged). */
  engagement_by_type: {
    post?: EngagementSlice;
    reel?: EngagementSlice;
    tagged?: EngagementSlice;
  };
  /** Distribuição: mediana, desvio, coeficiente de variação (consistente vs volátil). */
  distribution: {
    median_views: number;
    std_views: number;
    cv_views: number;  // coefficient of variation
    median_likes: number;
    std_likes: number;
    cv_likes: number;
  };
  /** Regularidade: intervalo médio entre posts (dias), desvio. */
  regularity: {
    avg_interval_days: number;
    std_interval_days: number;
  };
  /** Melhor dia da semana (0–6) e hora (0–23). */
  best_day: number;
  best_hour: number;
  /** Concentração de nicho por hashtags (0–100): 80%+ em poucas tags = nicho forte. */
  topic_concentration_score: number;
  /** Maior post / média — >5 indica dependência de viral. */
  viral_dependency_index: number;
  /** Evolução: últimos 10 vs 10 anteriores (variação %). */
  temporal_evolution: {
    last_10_avg_views: number;
    previous_10_avg_views: number;
    change_pct_views: number | null;
    last_10_avg_likes: number;
    previous_10_avg_likes: number;
    change_pct_likes: number | null;
  };
  /** Views por segundo médio (vídeos com duration). */
  views_per_second_avg: number | null;
}

const SECONDS_PER_WEEK = 7 * 24 * 3600;

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/\D/g, ''), 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function getPostTimestamp(p: PostForBi): number | null {
  const takenAt = p.post?.taken_at;
  if (takenAt != null && typeof takenAt === 'number') return takenAt;
  const content = p.content as { caption_created_at?: number } | undefined;
  if (content?.caption_created_at != null) return content.caption_created_at;
  const collected = (p.post as { collected_at?: string })?.collected_at;
  if (typeof collected === 'string') {
    const t = new Date(collected).getTime();
    return Number.isNaN(t) ? null : Math.floor(t / 1000);
  }
  return null;
}

function getContentType(p: PostForBi): string {
  return (p.content_type as string) || 'post';
}

function getMetrics(p: PostForBi): { likes: number; comments: number; views: number; videoDuration: number | null } {
  const m = p.metrics as Record<string, unknown> | undefined;
  return {
    likes: toNum(m?.likes ?? (p as { like_count?: number }).like_count),
    comments: toNum(m?.comments ?? (p as { comment_count?: number }).comment_count),
    views: toNum(m?.view_count ?? (p as { view_count?: number }).view_count),
    videoDuration: m?.video_duration != null ? toNum(m.video_duration) || null : null,
  };
}

function computeEngagementSlice(posts: PostForBi[], followersCount: number): EngagementSlice {
  let totalLikes = 0, totalComments = 0, totalViews = 0;
  for (const p of posts) {
    const { likes, comments, views } = getMetrics(p);
    totalLikes += likes;
    totalComments += comments;
    totalViews += views;
  }
  const n = posts.length;
  const totalInteractions = totalLikes + totalComments;
  const avgInteractions = n > 0 ? totalInteractions / n : 0;
  const engagement_rate = followersCount > 0 ? (avgInteractions / followersCount) * 100 : 0;
  return {
    posts_count: n,
    total_likes: totalLikes,
    total_comments: totalComments,
    total_views: totalViews,
    avg_likes: n > 0 ? Math.round(totalLikes / n) : 0,
    avg_comments: n > 0 ? Math.round(totalComments / n) : 0,
    avg_views: n > 0 ? Math.round(totalViews / n) : 0,
    engagement_rate: Math.round(engagement_rate * 100) / 100,
  };
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function stdDev(arr: number[], mean: number): number {
  if (arr.length < 2) return 0;
  const sumSq = arr.reduce((s, x) => s + (x - mean) ** 2, 0);
  return Math.sqrt(sumSq / (arr.length - 1));
}

/**
 * Calcula todas as métricas derivadas e BI a partir de perfil + posts (apenas dados Instagram).
 */
export function computeInstagramBi(
  followersCount: number,
  posts: PostForBi[]
): InstagramBi {
  const n = posts.length;
  const sortedByTime = [...posts]
    .map((p) => ({ p, ts: getPostTimestamp(p) }))
    .filter((x): x is { p: PostForBi; ts: number } => x.ts != null)
    .sort((a, b) => a.ts - b.ts);

  const allLikes = sortedByTime.map(({ p }) => getMetrics(p).likes);
  const allViews = sortedByTime.map(({ p }) => getMetrics(p).views);
  const totalLikes = allLikes.reduce((a, b) => a + b, 0);
  const totalComments = sortedByTime.reduce((s, { p }) => s + getMetrics(p).comments, 0);
  const totalViews = allViews.reduce((a, b) => a + b, 0);

  const totalInteractions = totalLikes + totalComments;
  const conversation_rate = totalInteractions > 0 ? totalComments / totalInteractions : 0;
  const like_view_ratio = totalViews > 0 ? totalLikes / totalViews : null;
  const comments_per_follower = followersCount > 0 ? totalComments / followersCount : 0;

  const avgViews = n > 0 ? totalViews / n : 0;
  const reach_ratio = followersCount > 0 ? avgViews / followersCount : 0;

  const byType = { post: [] as PostForBi[], reel: [] as PostForBi[], tagged: [] as PostForBi[] };
  for (const p of posts) {
    const ct = getContentType(p);
    if (ct === 'reel' && byType.reel) byType.reel.push(p);
    else if (ct === 'tagged' && byType.tagged) byType.tagged.push(p);
    else byType.post.push(p);
  }
  const engagement_by_type: InstagramBi['engagement_by_type'] = {};
  if (byType.post.length > 0) engagement_by_type.post = computeEngagementSlice(byType.post, followersCount);
  if (byType.reel.length > 0) engagement_by_type.reel = computeEngagementSlice(byType.reel, followersCount);
  if (byType.tagged.length > 0) engagement_by_type.tagged = computeEngagementSlice(byType.tagged, followersCount);

  const meanViews = n > 0 ? totalViews / n : 0;
  const meanLikes = n > 0 ? totalLikes / n : 0;
  const distribution = {
    median_views: median(allViews),
    std_views: stdDev(allViews, meanViews),
    cv_views: meanViews > 0 ? stdDev(allViews, meanViews) / meanViews : 0,
    median_likes: median(allLikes),
    std_likes: stdDev(allLikes, meanLikes),
    cv_likes: meanLikes > 0 ? stdDev(allLikes, meanLikes) / meanLikes : 0,
  };

  const intervals: number[] = [];
  for (let i = 1; i < sortedByTime.length; i++) {
    intervals.push((sortedByTime[i]!.ts - sortedByTime[i - 1]!.ts) / (24 * 3600));
  }
  const avgInterval = intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
  const regularity = {
    avg_interval_days: Math.round(avgInterval * 100) / 100,
    std_interval_days: intervals.length > 1 ? Math.round(stdDev(intervals, avgInterval) * 100) / 100 : 0,
  };

  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  const hourCounts = Array(24).fill(0);
  for (const { ts } of sortedByTime) {
    const d = new Date(ts * 1000);
    weekdayCounts[d.getDay()]++;
    hourCounts[d.getHours()]++;
  }
  const best_day = weekdayCounts.indexOf(Math.max(...weekdayCounts));
  const best_hour = hourCounts.indexOf(Math.max(...hourCounts));

  const tagCount: Record<string, number> = {};
  for (const p of posts) {
    const tags = ((p.content as { hashtags?: string[] })?.hashtags ?? []).filter((h): h is string => typeof h === 'string').map((h) => h.replace(/^#/, '').trim().toLowerCase()).filter(Boolean);
    for (const t of tags) tagCount[t] = (tagCount[t] ?? 0) + 1;
  }
  const tagEntries = Object.entries(tagCount).sort((a, b) => b[1] - a[1]);
  const totalTagUses = tagEntries.reduce((s, [, c]) => s + c, 0);
  const top3Count = tagEntries.slice(0, 3).reduce((s, [, c]) => s + c, 0);
  const topic_concentration_score = totalTagUses > 0 ? Math.min(100, Math.round((top3Count / totalTagUses) * 100)) : 0;

  const maxLikes = allLikes.length > 0 ? Math.max(...allLikes) : 0;
  const viral_dependency_index = meanLikes > 0 ? maxLikes / meanLikes : 0;

  const last10 = sortedByTime.slice(-10);
  const previous10 = sortedByTime.slice(-20, -10);
  const last10AvgViews = last10.length > 0 ? last10.reduce((s, { p }) => s + getMetrics(p).views, 0) / last10.length : 0;
  const previous10AvgViews = previous10.length > 0 ? previous10.reduce((s, { p }) => s + getMetrics(p).views, 0) / previous10.length : 0;
  const last10AvgLikes = last10.length > 0 ? last10.reduce((s, { p }) => s + getMetrics(p).likes, 0) / last10.length : 0;
  const previous10AvgLikes = previous10.length > 0 ? previous10.reduce((s, { p }) => s + getMetrics(p).likes, 0) / previous10.length : 0;
  const change_pct_views = previous10AvgViews > 0 ? ((last10AvgViews - previous10AvgViews) / previous10AvgViews) * 100 : null;
  const change_pct_likes = previous10AvgLikes > 0 ? ((last10AvgLikes - previous10AvgLikes) / previous10AvgLikes) * 100 : null;

  let viewsPerSecondSum = 0;
  let viewsPerSecondN = 0;
  for (const p of posts) {
    const { views, videoDuration } = getMetrics(p);
    if (videoDuration != null && videoDuration > 0 && views > 0) {
      viewsPerSecondSum += views / videoDuration;
      viewsPerSecondN++;
    }
  }
  const views_per_second_avg = viewsPerSecondN > 0 ? Math.round((viewsPerSecondSum / viewsPerSecondN) * 100) / 100 : null;

  return {
    reach_ratio: Math.round(reach_ratio * 10000) / 10000,
    conversation_rate: Math.round(conversation_rate * 100) / 100,
    like_view_ratio: like_view_ratio != null ? Math.round(like_view_ratio * 10000) / 10000 : null,
    comments_per_follower: Math.round(comments_per_follower * 100) / 100,
    engagement_by_type,
    distribution: {
      ...distribution,
      cv_views: Math.round(distribution.cv_views * 100) / 100,
      cv_likes: Math.round(distribution.cv_likes * 100) / 100,
    },
    regularity,
    best_day,
    best_hour,
    topic_concentration_score,
    viral_dependency_index: Math.round(viral_dependency_index * 100) / 100,
    temporal_evolution: {
      last_10_avg_views: Math.round(last10AvgViews),
      previous_10_avg_views: Math.round(previous10AvgViews),
      change_pct_views: change_pct_views != null ? Math.round(change_pct_views * 100) / 100 : null,
      last_10_avg_likes: Math.round(last10AvgLikes),
      previous_10_avg_likes: Math.round(previous10AvgLikes),
      change_pct_likes: change_pct_likes != null ? Math.round(change_pct_likes * 100) / 100 : null,
    },
    views_per_second_avg,
  };
}
