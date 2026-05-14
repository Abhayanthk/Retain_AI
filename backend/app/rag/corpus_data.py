"""
Curated retention/churn framework corpus.
Each chunk: {id, text, metadata: {source, topic, signals, industry}}
Signals are the tags used to match against detected data patterns.
"""

CORPUS = [
    # ── Activation / Aha Moment ──────────────────────────────
    {
        "id": "reforge_aha_001",
        "text": "The Aha Moment is the point where a new user first experiences the core value of a product. Companies with weak onboarding see high short-tenure churn because users never hit this threshold. To find it, segment users into retained vs churned cohorts and identify the earliest behavior that differentiates them. Common examples: Slack's '2,000 messages sent per team', Facebook's '7 friends in 10 days', Dropbox's 'at least one file in one folder on two devices'.",
        "metadata": {"source": "Reforge - Activation Framework", "topic": "activation", "signals": "short_tenure_churn,low_usage,new_user_drop_off", "industry": "saas"},
    },
    {
        "id": "reforge_aha_002",
        "text": "Time-to-value is the strongest predictor of long-term retention. If users don't reach the aha moment within their first session (B2C) or first week (B2B), probability of churn increases 3-5x. Fix: instrument activation events, set a threshold, and optimize onboarding to get new users to cross it as fast as possible. Every friction point before aha is a churn multiplier.",
        "metadata": {"source": "Reforge - Time to Value", "topic": "onboarding", "signals": "short_tenure_churn,onboarding_friction,new_user_drop_off", "industry": "saas"},
    },
    {
        "id": "intercom_onboarding_001",
        "text": "Onboarding-driven churn is identifiable by a sharp drop in the survival curve within the first 30 days. Root causes typically fall into: (1) unclear value proposition, (2) setup friction (signup, integration, invite teammates), (3) missing 'first win' moment. Remediation: progressive disclosure, guided setup, email drip that surfaces the highest-value feature first.",
        "metadata": {"source": "Intercom - Onboarding Research", "topic": "onboarding", "signals": "short_tenure_churn,30_day_cliff,new_user_drop_off", "industry": "saas"},
    },

    # ── Product-Market Fit & Feature Adoption ────────────────
    {
        "id": "balfour_pmf_001",
        "text": "Retention flattening (horizontal retention curve) indicates strong product-market fit. A curve that trends to zero means users find initial value but no ongoing reason to return. Root cause: the core use case is either one-shot or lacks a natural trigger for reuse. Fix: identify the behavioral loop that should bring users back and instrument whether it actually happens.",
        "metadata": {"source": "Brian Balfour - Retention Curves", "topic": "pmf", "signals": "gradual_churn,flat_retention,no_hook", "industry": "saas"},
    },
    {
        "id": "reforge_adoption_001",
        "text": "Feature adoption gaps drive mid-tenure churn. Users who activate but never adopt a second or third core feature typically churn between months 3-9. This is a 'shallow engagement' pattern. Fix: build feature-adoption nudges timed to user lifecycle. Trigger based on inactivity in a feature, not just calendar time.",
        "metadata": {"source": "Reforge - Feature Adoption", "topic": "engagement", "signals": "mid_tenure_churn,low_feature_adoption,shallow_engagement", "industry": "saas"},
    },
    {
        "id": "chen_network_001",
        "text": "Users who invite teammates or connect integrations in their first week retain at 2-3x the rate of solo users. Network effects and switching costs compound over time. For B2B SaaS, integration setup is the single strongest retention predictor after activation. Prioritize integration wizards and invite flows.",
        "metadata": {"source": "Andrew Chen - Network Effects", "topic": "network_effects", "signals": "low_integration,solo_user,b2b_churn", "industry": "saas"},
    },

    # ── Pricing / Monetization Churn ─────────────────────────
    {
        "id": "profitwell_pricing_001",
        "text": "Involuntary churn (failed payments) accounts for 20-40% of total SaaS churn. Symptoms: spikes in churn at billing cycle boundaries, correlation with card expiry dates. Fix: dunning sequences, card updater services (Stripe/Braintree), pre-dunning emails, and retry logic with exponential backoff. This is typically the highest-ROI churn intervention.",
        "metadata": {"source": "ProfitWell - Involuntary Churn", "topic": "pricing", "signals": "billing_cycle_churn,payment_failure,involuntary_churn", "industry": "saas"},
    },
    {
        "id": "profitwell_pricing_002",
        "text": "Price-related churn is identifiable by (a) high churn concentrated in lowest-tier plans, (b) exit surveys citing 'too expensive', (c) churn spikes after price changes. Diagnostic: compare churn rates across plan tiers. Fix options: introduce a lower-tier plan to capture downgraders, offer annual discounts, or build value-based pricing that scales with customer success.",
        "metadata": {"source": "ProfitWell - Price Sensitivity", "topic": "pricing", "signals": "plan_tier_churn,price_sensitivity,low_tier_concentration", "industry": "saas"},
    },

    # ── Engagement Decay / Habit ─────────────────────────────
    {
        "id": "eyal_hooks_001",
        "text": "The Hook Model: trigger → action → variable reward → investment. Products that build habits have all four. Churn from habit-failure looks like: user is active initially, then frequency decays, then session length shrinks, then they disappear. Fix: identify which stage of the hook is failing. Missing triggers (no notifications/emails) is the most common.",
        "metadata": {"source": "Nir Eyal - Hooked", "topic": "engagement", "signals": "frequency_decay,no_trigger,habit_failure", "industry": "b2c,saas"},
    },
    {
        "id": "reforge_engagement_001",
        "text": "Engagement decay precedes churn by an average of 60 days in B2B SaaS. Early warning signals: decreased login frequency, reduced session length, fewer active features per user. Build a health score from these signals and trigger CS interventions before churn, not after. Users who drop below 50% of their baseline usage for 2 weeks have 4x churn probability.",
        "metadata": {"source": "Reforge - Health Scores", "topic": "engagement", "signals": "engagement_decay,health_score,leading_indicator", "industry": "saas"},
    },

    # ── Customer Success / Support ───────────────────────────
    {
        "id": "intercom_support_001",
        "text": "Users with 3+ support tickets in their first 30 days churn at 2x the baseline rate. However, users whose tickets are resolved in under 4 hours churn at half the baseline rate. Support is a double-edged signal: high volume = friction, but fast resolution = trust-building. Segment by resolution time, not just ticket count.",
        "metadata": {"source": "Intercom - Support as Retention", "topic": "support", "signals": "high_support_volume,slow_resolution,early_friction", "industry": "saas"},
    },
    {
        "id": "gainsight_cs_001",
        "text": "Customer Success-led retention works best for ACV > $10k. For smaller accounts, automated health scoring + in-product nudges outperform human CS by cost. Signal to look for: correlation between CS touchpoints (QBRs, check-ins) and retention within a tier. If no correlation, the CS motion is not working.",
        "metadata": {"source": "Gainsight - CS Segmentation", "topic": "customer_success", "signals": "enterprise_churn,high_acv,cs_motion", "industry": "saas_b2b"},
    },

    # ── Segmentation / ICP ───────────────────────────────────
    {
        "id": "reforge_icp_001",
        "text": "Bad-fit customers churn at 3-5x the rate of ideal-fit. Signals of bad-fit acquisition: high churn concentrated in one acquisition channel, industry, or company size. Paid ads and cold outbound tend to bring more bad-fit users than content/referral. Fix: tighten ICP qualification in the funnel, or kill the bad channel entirely.",
        "metadata": {"source": "Reforge - ICP Fit", "topic": "acquisition_quality", "signals": "channel_churn,bad_fit,acquisition_quality", "industry": "saas"},
    },
    {
        "id": "forrester_segment_001",
        "text": "Segment retention curves can differ by 2-4x between cohorts. Never look at aggregate retention — it hides the real story. Break down by: acquisition channel, plan tier, industry, company size, signup month. The segment with the lowest retention is usually both your biggest problem AND your most actionable lever.",
        "metadata": {"source": "Forrester - Cohort Analysis", "topic": "segmentation", "signals": "channel_variance,segment_analysis,cohort", "industry": "saas"},
    },

    # ── Integration / Technical Adoption ─────────────────────
    {
        "id": "reforge_integrations_001",
        "text": "For B2B SaaS, integration setup is a 'switching cost moat'. Users with 0 integrations churn at baseline; 1 integration reduces churn by 30%, 3+ integrations reduces churn by 60-70%. If integrations are optional in onboarding, most users will skip them and churn later. Fix: make the first integration mandatory or strongly guided.",
        "metadata": {"source": "Reforge - Switching Costs", "topic": "integration", "signals": "low_integration,b2b_churn,switching_cost", "industry": "saas_b2b"},
    },
    {
        "id": "zapier_integration_001",
        "text": "Integration failures are a hidden churn driver. Users who set up an integration that later breaks (API deprecation, credential expiry, data sync error) churn at 2x the rate of users whose integrations work. Fix: proactive integration health monitoring, auto-retry on failure, clear error UX that tells users what to fix.",
        "metadata": {"source": "Zapier - Integration Reliability", "topic": "integration", "signals": "integration_failure,technical_churn,broken_integration", "industry": "saas"},
    },

    # ── Long-tenure / Plateau ────────────────────────────────
    {
        "id": "baxter_forever_001",
        "text": "Long-tenure churn (users who leave after 12+ months) is usually caused by (1) stagnation — product hasn't improved visibly since signup, (2) changed needs — user's company or role shifted, (3) competitor switch. Diagnostic: exit interviews matter more than data here. These users are hardest to save; focus on expansion revenue instead.",
        "metadata": {"source": "Robbie Kellman Baxter - The Forever Transaction", "topic": "long_tenure", "signals": "long_tenure_churn,stagnation,competitor_switch", "industry": "saas"},
    },
    {
        "id": "reforge_expansion_001",
        "text": "Expansion revenue (upsells, cross-sells, seat growth) is the #1 defense against long-tenure churn. Users who expand stay 2-3x longer than flat-spend users. If your long-tenure cohort has flat MRR per account, you have a stagnation problem. Fix: build expansion triggers into product milestones, not just sales QBRs.",
        "metadata": {"source": "Reforge - NRR", "topic": "expansion", "signals": "long_tenure_churn,flat_mrr,no_expansion", "industry": "saas_b2b"},
    },

    # ── Drop-off / Survival Patterns ─────────────────────────
    {
        "id": "intercom_30day_001",
        "text": "30-day cliff: a sharp drop in the survival curve around days 25-35 indicates onboarding-phase churn where users hit a setup wall. Common causes: required config step that fails, missing feature they expected at signup, team adoption stalled. Fix: instrument the 30-day user journey and find the specific step where users stop progressing.",
        "metadata": {"source": "Intercom - 30-Day Cliff", "topic": "onboarding", "signals": "30_day_cliff,onboarding_friction,setup_wall", "industry": "saas"},
    },
    {
        "id": "reforge_90day_001",
        "text": "90-day cliff: churn spike around months 3-4 typically means the honeymoon period ended. Users extracted initial value but didn't build a habit. Root cause is usually absent re-engagement: no new-feature exposure, no workflow deepening, no team expansion. Fix: 90-day milestone campaign with specific feature goals and QBR-lite check-in.",
        "metadata": {"source": "Reforge - 90-Day Retention", "topic": "engagement", "signals": "90_day_cliff,honeymoon_end,mid_tenure_churn", "industry": "saas"},
    },
    {
        "id": "bain_gradual_001",
        "text": "Gradual, linear churn (no obvious cliffs) indicates distributed root causes rather than one broken step. Don't chase a single cause — prioritize by segment. Run cohort analysis across plan tier, channel, and company size; the worst segment usually reveals a concentrated cause that the aggregate curve hides.",
        "metadata": {"source": "Bain - Loyalty Economics", "topic": "diagnosis", "signals": "gradual_churn,linear_decline,no_cliff", "industry": "saas"},
    },

    # ── Win-back / Recovery ──────────────────────────────────
    {
        "id": "profitwell_winback_001",
        "text": "Churned users are 4x more likely to return than new prospects to convert. Win-back campaigns should trigger 30-60 days after churn, lead with changes the product made since they left, and offer a re-activation incentive (free month, reduced plan). Exit survey data is the input that makes win-back work.",
        "metadata": {"source": "ProfitWell - Win-back", "topic": "winback", "signals": "churned_user,reactivation,exit_signal", "industry": "saas"},
    },

    # ── B2B specific ─────────────────────────────────────────
    {
        "id": "saastr_champion_001",
        "text": "In B2B, the champion leaving is the #1 unaddressed churn driver. When the user who originally bought or advocated for the product leaves the customer's company, churn probability jumps 3-5x within 6 months. Fix: detect champion departure (LinkedIn monitoring, login drop from key user), and have CS re-establish value with the replacement.",
        "metadata": {"source": "SaaStr - Champion Churn", "topic": "b2b", "signals": "champion_departure,b2b_churn,stakeholder_change", "industry": "saas_b2b"},
    },
    {
        "id": "saastr_seatgrowth_001",
        "text": "Seat stagnation in B2B is a leading indicator of churn. Accounts whose seat count hasn't grown in 6+ months churn at 2x the rate of accounts with any seat growth. If the buyer can't justify expanding, they usually can't justify renewing. Track seat growth as a health metric.",
        "metadata": {"source": "SaaStr - Seat Expansion", "topic": "b2b", "signals": "seat_stagnation,b2b_churn,flat_seats", "industry": "saas_b2b"},
    },

    # ── Diagnosis methodology ────────────────────────────────
    {
        "id": "method_survival_001",
        "text": "When diagnosing churn, always start with the shape of the survival curve. A sharp cliff = single broken step. Gradual decline = distributed causes. Flat line = no retention at all (PMF issue). The shape tells you whether to look for one bug or many segments. Survival analysis should always precede root-cause hypotheses.",
        "metadata": {"source": "Retention Diagnosis Methodology", "topic": "diagnosis", "signals": "diagnosis_methodology,survival_shape,root_cause", "industry": "saas"},
    },
    {
        "id": "method_segmentation_001",
        "text": "Segment-level churn diagnosis beats aggregate every time. Break down churn by at least three dimensions: acquisition channel (did we buy bad-fit users?), plan tier (is pricing a factor?), and tenure cohort (is this a new or structural problem?). The intersection with the worst retention rate is where to focus.",
        "metadata": {"source": "Retention Diagnosis Methodology", "topic": "diagnosis", "signals": "segmentation,cohort_analysis,root_cause", "industry": "saas"},
    },
    {
        "id": "method_correlations_001",
        "text": "Correlation is not causation in churn analysis. If low-usage users churn more, the cause might be (a) they found a better tool, (b) their use case disappeared, or (c) they never activated. Each implies a different intervention. Always ask 'why did usage drop?' rather than treating usage as the root cause.",
        "metadata": {"source": "Retention Diagnosis Methodology", "topic": "diagnosis", "signals": "correlation_vs_causation,usage_decay,root_cause", "industry": "saas"},
    },

    # ── Retention playbooks / frameworks ─────────────────────
    {
        "id": "playbook_onboarding_001",
        "text": "Onboarding remediation playbook: (1) Instrument activation event, (2) measure % of signups who hit it within N days, (3) identify top 3 drop-off points in the funnel, (4) fix the #1 drop-off with a guided tour, default values, or removed step, (5) A/B test. Typical lift: 15-30% activation rate increase, which translates to 10-20% retention improvement.",
        "metadata": {"source": "Retention Playbook - Onboarding Fix", "topic": "playbook", "signals": "onboarding_friction,activation_fix,playbook", "industry": "saas"},
    },
    {
        "id": "playbook_engagement_001",
        "text": "Engagement decay playbook: (1) build a usage-based health score (frequency + breadth + depth), (2) identify the score threshold below which churn probability exceeds 50%, (3) trigger lifecycle emails + in-app nudges when users cross the threshold downward, (4) escalate to CS for high-ACV accounts. Targets a 20-30% reduction in mid-tenure churn.",
        "metadata": {"source": "Retention Playbook - Health Score", "topic": "playbook", "signals": "engagement_decay,health_score,playbook", "industry": "saas"},
    },
    {
        "id": "playbook_pricing_001",
        "text": "Pricing-churn playbook: (1) run exit survey focused on willingness-to-pay, (2) cohort churn by plan tier, (3) if bottom tier churns >2x: introduce a downgrade-save offer (lower tier or pause), (4) if all tiers churn: the overall price:value ratio is wrong, not the tier structure. Dunning + card updater for involuntary is always step 0.",
        "metadata": {"source": "Retention Playbook - Pricing", "topic": "playbook", "signals": "pricing_churn,tier_analysis,playbook", "industry": "saas"},
    },
    {
        "id": "playbook_integration_001",
        "text": "Integration-churn playbook: (1) make the first integration mandatory in onboarding (or strongly defaulted), (2) monitor integration health (sync success rate, auth token validity), (3) alert on integration failure and offer one-click fix, (4) track integration count as a retention health metric. B2B products without this playbook leave 30%+ of retention on the table.",
        "metadata": {"source": "Retention Playbook - Integration", "topic": "playbook", "signals": "low_integration,integration_failure,playbook", "industry": "saas_b2b"},
    },
    {
        "id": "playbook_winback_001",
        "text": "Win-back playbook: (1) send email 30 days post-churn leading with product changes since they left, (2) offer re-activation incentive (free month or discount), (3) segment by churn reason — users who churned for price get different offers than users who churned for missing features, (4) track re-activation rate as a KPI. Typical 5-15% reactivation.",
        "metadata": {"source": "Retention Playbook - Win-back", "topic": "playbook", "signals": "winback,reactivation,playbook", "industry": "saas"},
    },

    # ── Benchmarks ───────────────────────────────────────────
    {
        "id": "benchmark_saas_001",
        "text": "SaaS retention benchmarks (best-in-class): B2B SMB 85-90% annual, B2B mid-market 90-95%, B2B enterprise 95%+, B2C SaaS 50-70%. Monthly churn >5% for B2B SMB is a red flag; >2% for enterprise is a crisis. Net Revenue Retention >110% indicates healthy expansion.",
        "metadata": {"source": "OpenView / KeyBanc SaaS Benchmarks", "topic": "benchmarks", "signals": "benchmarks,nrr,industry_comparison", "industry": "saas"},
    },
    {
        "id": "benchmark_activation_001",
        "text": "Activation rate benchmarks: B2C apps 20-40%, B2B freemium 10-25%, B2B trial-to-paid 10-20%. If your activation rate is below these ranges, fix activation before anything else downstream. If above, focus on retention beyond activation.",
        "metadata": {"source": "OpenView - Activation Benchmarks", "topic": "benchmarks", "signals": "activation_benchmark,industry_comparison", "industry": "saas"},
    },

    # ── PLG / Self-serve ─────────────────────────────────────
    {
        "id": "plg_selfserve_001",
        "text": "Product-led growth retention requires the product to be the acquisition AND retention engine. Key metrics: time-to-value under 5 minutes, viral coefficient, product qualified leads. Failure mode: treating PLG like classic sales — ignoring in-product activation because 'CS will handle it'. CS doesn't scale for PLG.",
        "metadata": {"source": "Wes Bush - Product-Led Growth", "topic": "plg", "signals": "plg,self_serve,time_to_value", "industry": "saas"},
    },

    # ── Content / Education ──────────────────────────────────
    {
        "id": "content_education_001",
        "text": "User education reduces churn 10-20% when tied to actual usage gaps. Generic 'weekly tips' emails have 1-3% CTR and near-zero retention impact. Instead: detect which feature a user hasn't adopted, trigger education only about that feature, measure adoption as the success metric, not email open rate.",
        "metadata": {"source": "HubSpot - Lifecycle Email", "topic": "education", "signals": "user_education,email_campaign,feature_adoption", "industry": "saas"},
    },

    # ── High Churn / General ────────────────────────────────
    {
        "id": "high_churn_general_001",
        "text": "When overall churn exceeds 25%, the problem is almost never a single root cause. High aggregate churn is typically a combination of (1) acquisition of bad-fit customers, (2) weak activation, and (3) absence of an engagement loop. Prioritize by segmenting: which plan, channel, or tenure cohort has the worst retention? That segment usually accounts for 60-80% of total churn volume. Fix the worst segment first, not the average.",
        "metadata": {"source": "Retention Diagnosis - High Churn", "topic": "diagnosis", "signals": "high_churn,gradual_churn,segment_analysis", "industry": "saas"},
    },
    {
        "id": "high_churn_general_002",
        "text": "Companies with churn rates above 30% should ask: is this a product problem or a customer problem? If your best cohort (e.g., enterprise, referral customers) retains well (>90% annually), the product works — you're just acquiring wrong customers. If even your best cohort churns, you have a product-market fit gap. The diagnostic is simple: segment retention by every available dimension and find the one that stays.",
        "metadata": {"source": "First Round Capital - Churn Triage", "topic": "diagnosis", "signals": "high_churn,bad_fit,acquisition_quality,segment_analysis", "industry": "saas"},
    },

    # ── Long Tenure Churn ───────────────────────────────────
    {
        "id": "long_tenure_002",
        "text": "Long-tenure churn in B2B SaaS often peaks at contract renewal boundaries (month 12, 24, 36). The customer didn't suddenly become unhappy — they've been accumulating dissatisfaction for months but had no exit point. By the time renewal comes, they've already evaluated alternatives. Fix: start re-engagement 90 days before renewal. Surface new features, run a business review, and quantify the ROI they've received.",
        "metadata": {"source": "Gainsight - Renewal Playbook", "topic": "long_tenure", "signals": "long_tenure_churn,stagnation,billing_cycle_churn", "industry": "saas_b2b"},
    },
    {
        "id": "long_tenure_003",
        "text": "When mature users churn after 12+ months, exit interviews reveal three patterns: (1) 'We outgrew you' — they need enterprise features you don't have, (2) 'Nothing changed' — your product stagnated while competitors shipped features, (3) 'New leadership' — a new VP chose a different vendor. Pattern 1 is solved by upsell paths, pattern 2 by visible product velocity, pattern 3 by multi-threading relationships across the org.",
        "metadata": {"source": "SaaStr - Mature Churn Patterns", "topic": "long_tenure", "signals": "long_tenure_churn,competitor_switch,champion_departure,stagnation", "industry": "saas_b2b"},
    },

    # ── Contract Renewal / Annual Billing ───────────────────
    {
        "id": "renewal_cliff_001",
        "text": "Annual contract renewal is the highest-risk moment in B2B SaaS. 40-60% of all churn happens within 30 days of renewal date. The solution is a 90-day renewal campaign: Day -90: automated health check email showing usage stats and ROI. Day -60: CSM QBR with success metrics. Day -30: renewal offer with incentive for multi-year. Day -7: executive sponsor outreach. Companies running this playbook see 15-25% improvement in renewal rates.",
        "metadata": {"source": "Totango - Renewal Playbook", "topic": "renewal", "signals": "billing_cycle_churn,long_tenure_churn,annual_renewal", "industry": "saas_b2b"},
    },
    {
        "id": "renewal_cliff_002",
        "text": "If you see a churn spike at months 11-13, your annual contracts lack a renewal nurture sequence. Most companies treat renewal as a billing event, not a retention event. The 90 days before renewal should include: (1) Success metrics dashboard sent automatically, (2) Feature adoption gaps highlighted with training offers, (3) Competitive comparison showing why switching is costly, (4) Executive alignment meeting. This transforms renewal from a risk moment into an expansion opportunity.",
        "metadata": {"source": "ChurnZero - Pre-Renewal Strategy", "topic": "renewal", "signals": "billing_cycle_churn,long_tenure_churn,annual_renewal,90_day_cliff", "industry": "saas_b2b"},
    },

    # ── Plan Tier Churn ─────────────────────────────────────
    {
        "id": "tier_churn_001",
        "text": "When your lowest-tier plan churns 3-5× more than upper tiers, you have a value delivery problem, not a product problem. The product works — your best customers prove it. The lowest tier likely doesn't include the features that create stickiness (integrations, collaboration, automations). Fix options: (1) move key sticky features down a tier, (2) eliminate the lowest tier and make Professional the entry point, (3) create a guided upgrade path when users hit the value ceiling.",
        "metadata": {"source": "ProfitWell - Tier Optimization", "topic": "pricing", "signals": "plan_tier_churn,low_tier_concentration,price_sensitivity,high_churn", "industry": "saas"},
    },
    {
        "id": "tier_churn_002",
        "text": "Starter/free tier churn above 40% is normal for PLG but catastrophic for sales-led. If you're paying to acquire Starter customers via paid ads or outbound, and they churn at 40%+, your unit economics are broken. Calculate CAC-to-LTV for the Starter tier specifically. If it's below 3:1, either (a) stop acquiring Starter customers, (b) convert Starter to a free tier and monetize through upgrade, or (c) raise the Starter price to match the value floor.",
        "metadata": {"source": "OpenView - PLG Pricing", "topic": "pricing", "signals": "plan_tier_churn,high_churn,bad_fit,price_sensitivity", "industry": "saas"},
    },

    # ── NPS & Satisfaction ──────────────────────────────────
    {
        "id": "nps_churn_001",
        "text": "NPS below 5 correlates with 3× churn probability. But NPS is a lagging indicator — by the time someone scores you a 3, they've already decided to leave. The actionable version: track NPS delta (change over time). A user who drops from NPS 8 to NPS 5 between surveys is at higher risk than a user who's been at NPS 5 the whole time. Trigger interventions on NPS decline, not absolute score.",
        "metadata": {"source": "Bain - NPS & Retention", "topic": "satisfaction", "signals": "nps_decline,health_score,leading_indicator,engagement_decay", "industry": "saas"},
    },
    {
        "id": "nps_churn_002",
        "text": "Segment NPS by plan tier to find value delivery gaps. If Enterprise NPS is 8+ but Starter NPS is 3-4, the product delivers value only at scale. This indicates the Starter product is either missing key features or the onboarding doesn't help small teams extract value. Fix: create a Starter-specific onboarding path that focuses on the 1-2 features that matter most at that scale, not the full feature set.",
        "metadata": {"source": "Gainsight - NPS Segmentation", "topic": "satisfaction", "signals": "nps_decline,plan_tier_churn,low_tier_concentration", "industry": "saas"},
    },

    # ── Disengagement / Low Usage ───────────────────────────
    {
        "id": "disengagement_001",
        "text": "Users logging in fewer than 10 times per month in a B2B tool are effectively churned — they just haven't canceled yet. These 'zombie accounts' create false retention metrics. Mark accounts with <25% of median usage as 'at-risk' and trigger automated re-engagement: (1) personalized email showing what they're missing, (2) in-app prompt surfacing their most-used feature, (3) CSM outreach if ACV >$5K. Re-engage within 14 days of usage drop or lose them.",
        "metadata": {"source": "Amplitude - Engagement Analysis", "topic": "engagement", "signals": "engagement_decay,frequency_decay,health_score,leading_indicator", "industry": "saas"},
    },
    {
        "id": "disengagement_002",
        "text": "Login frequency is the single strongest leading indicator of churn in most SaaS products. Build a 3-tier alert system: Green (>75% of median logins), Yellow (25-75%), Red (<25%). Yellow triggers automated nudges. Red triggers human outreach. The key insight: a user at Yellow for 2 weeks is more at-risk than a user who just dropped to Red — sustained disengagement is harder to reverse than sudden drops.",
        "metadata": {"source": "Mixpanel - Engagement Modeling", "topic": "engagement", "signals": "engagement_decay,frequency_decay,health_score,high_churn", "industry": "saas"},
    },

    # ── Support Overload ────────────────────────────────────
    {
        "id": "support_overload_001",
        "text": "When a segment averages 5+ support tickets per user, the product has a usability problem for that segment. High ticket volume is not a support problem — it's a product problem. Analyze ticket categories: if >40% are 'how do I...?' questions, you need better onboarding and in-app guidance. If >40% are bugs/errors, you need engineering focus on that tier. Don't hire more support; fix the root cause.",
        "metadata": {"source": "Zendesk - Support Analytics", "topic": "support", "signals": "high_support_volume,early_friction,onboarding_friction,high_churn", "industry": "saas"},
    },

    # ── Competitive Loss ────────────────────────────────────
    {
        "id": "competitive_loss_001",
        "text": "When churned customers build in-house alternatives instead of switching to competitors, your product's value proposition has a substitutability problem. This happens when: (1) your product solves a simple problem that a spreadsheet or script can replace, (2) API-first competitors let customers embed the functionality, (3) engineering teams view your tool as a temporary solution. Fix: increase switching costs by becoming the system of record, not just a tool.",
        "metadata": {"source": "a16z - Moats & Retention", "topic": "competitive", "signals": "competitor_switch,long_tenure_churn,stagnation,no_hook", "industry": "saas"},
    },

    # ── Fintech / Billing specific ──────────────────────────
    {
        "id": "fintech_billing_001",
        "text": "Billing and invoicing SaaS has unique retention dynamics: switching costs compound with time (migration of invoice history, API integrations, accounting mappings). The dangerous period is pre-integration: users who haven't connected their accounting software by month 3 churn at 4× the rate of integrated users. Make accounting integration the hero metric of onboarding, not generic login frequency.",
        "metadata": {"source": "Stripe - Billing SaaS Retention", "topic": "fintech", "signals": "low_integration,b2b_churn,onboarding_friction,short_tenure_churn", "industry": "fintech"},
    },
    {
        "id": "fintech_billing_002",
        "text": "For fintech B2B products, regulatory compliance creates both retention moats and churn risks. Users who've configured tax rules, multi-currency support, or compliance workflows rarely churn (switching cost too high). Users on basic invoicing without these features see the product as replaceable. Upsell path: guide mid-tenure users into compliance features as their business grows — this creates permanent lock-in.",
        "metadata": {"source": "Chargebee - Fintech Retention", "topic": "fintech", "signals": "long_tenure_churn,low_integration,switching_cost,b2b_churn", "industry": "fintech"},
    },

    # ── SMB specific ────────────────────────────────────────
    {
        "id": "smb_retention_001",
        "text": "SMB churn is fundamentally different from enterprise churn. SMBs churn because: (1) the business itself fails (15-20% annually — you can't prevent this), (2) the owner wears too many hats and stops using the tool, (3) price sensitivity — any economic downturn triggers cost-cutting. Filter natural business death from your churn metrics, then focus on (2) and (3). Automated workflows that reduce manual effort are the #1 SMB retention lever.",
        "metadata": {"source": "Baremetrics - SMB SaaS", "topic": "smb", "signals": "high_churn,price_sensitivity,engagement_decay,plan_tier_churn", "industry": "saas_smb"},
    },

    # ── Expansion / Upsell as Retention ─────────────────────
    {
        "id": "expansion_retention_001",
        "text": "Expansion revenue is retention's best friend. Users who upgrade or add seats within their first 6 months have 70-80% lower churn than flat-spend users. The mechanism is psychological: expanding means they're investing in the tool, which increases commitment and switching costs. Build natural upgrade triggers into product milestones: 'You've hit 100 invoices — unlock batch processing with Professional.'",
        "metadata": {"source": "Bessemer - Cloud Index", "topic": "expansion", "signals": "no_expansion,flat_mrr,long_tenure_churn,stagnation", "industry": "saas_b2b"},
    },

    # ── Cohort-Based Diagnosis ──────────────────────────────
    {
        "id": "cohort_diagnosis_001",
        "text": "The most powerful churn diagnostic is the plan×tenure matrix. Create a grid: rows are plan tiers, columns are tenure buckets (0-3, 3-6, 6-12, 12+ months). Each cell shows churn rate. The cell with the darkest red is your #1 priority. Typical patterns: (1) bottom-left = onboarding problem, (2) top-right = expansion/renewal problem, (3) entire bottom row = pricing/value problem in that tier.",
        "metadata": {"source": "Retention Diagnosis - Cohort Matrix", "topic": "diagnosis", "signals": "segment_analysis,cohort_analysis,plan_tier_churn,high_churn,root_cause", "industry": "saas"},
    },
    {
        "id": "cohort_diagnosis_002",
        "text": "When churn is concentrated in a single plan tier (>3× other tiers), do NOT try to 'fix' that plan. Instead, ask: should this plan exist? Many SaaS companies have a Starter plan that costs more to support than it generates in revenue. If Starter CAC payback >18 months and churn >40%, the plan is value-destructive. Options: raise price, remove features that cause support burden, or sunset the tier entirely.",
        "metadata": {"source": "SaaStr - Plan Portfolio", "topic": "pricing", "signals": "plan_tier_churn,high_churn,bad_fit,low_tier_concentration", "industry": "saas"},
    },

    # ── Competitor Positioning (F14) ──────────────────────────
    # When `churn_destination` names one of these, competitor_research_node retrieves
    # the matching chunk so strategy agents can recommend defensible counter-positioning.
    {
        "id": "competitor_slack_teams",
        "text": "Slack loses customers to Microsoft Teams primarily on bundling — Teams ships free with Microsoft 365 so finance teams treat Slack's per-seat cost as redundant. Slack retains best when (1) integrations make it a workflow hub the user can't replicate in Teams, (2) the company has hit the Slack 'aha' of 2,000 messages/team, and (3) admins value the better third-party app ecosystem. Counter-positioning playbook: surface a 'workflow integration audit' for at-risk teams, package Slack Connect (cross-company channels) as the must-have, and offer non-discount retention (extended free upgrade for admins committing 12 months).",
        "metadata": {"source": "Competitor Positioning - Slack vs Teams", "topic": "competitor_positioning", "signals": "competitor_threat,bundling_loss,b2b_churn,switching_to_incumbent", "industry": "saas_collab"},
    },
    {
        "id": "competitor_hubspot_salesforce",
        "text": "HubSpot loses upmarket customers to Salesforce when their pipeline grows past ~50 sales reps or they need complex territory management. HubSpot retains best by leaning into ease-of-use, integrated marketing + CRM, and Sales Hub Enterprise pricing parity for sub-200-rep teams. Counter-play: when churn_destination is Salesforce, propose (1) a 'consolidation TCO comparison' explicitly priced against Salesforce + Marketo + Pardot, (2) named-account expansion via HubSpot Operations Hub instead of buying Salesforce, (3) executive sponsor map so the buyer survives a Salesforce-pitch internal review.",
        "metadata": {"source": "Competitor Positioning - HubSpot vs Salesforce", "topic": "competitor_positioning", "signals": "competitor_threat,upmarket_churn,b2b_churn,enterprise_pull", "industry": "saas_crm"},
    },
    {
        "id": "competitor_intercom_zendesk",
        "text": "Intercom loses to Zendesk when companies grow beyond ~100 support agents and need ticketing rigor, omnichannel routing, and SLAs. Intercom retains best on conversational-first support teams that value automation (Fin AI, Resolution Bot) and proactive messaging. Counter-play: when destination is Zendesk, lead with Fin AI deflection rates (typical 30-50%), bundle Intercom Messenger as a marketing/onboarding tool not just a help widget, and offer agent-seat consolidation pricing for teams under 200 agents.",
        "metadata": {"source": "Competitor Positioning - Intercom vs Zendesk", "topic": "competitor_positioning", "signals": "competitor_threat,scale_friction,b2b_churn,support_tooling", "industry": "saas_support"},
    },
    {
        "id": "competitor_notion_confluence",
        "text": "Notion loses enterprise accounts to Confluence when IT/security teams require SOC2 Type II, audit logging, and Atlassian-stack integration with Jira. Notion retains best with product/design/marketing functions that value flexibility and the AI features. Counter-play: when churn_destination is Confluence, emphasize Notion AI's roadmap, ship admin-control parity (granular permissions, content lifecycle, audit), and offer non-Atlassian customers a Jira-integration roadmap commitment as part of renewal.",
        "metadata": {"source": "Competitor Positioning - Notion vs Confluence", "topic": "competitor_positioning", "signals": "competitor_threat,enterprise_pull,b2b_churn,security_gap", "industry": "saas_docs"},
    },
    {
        "id": "competitor_asana_jira",
        "text": "Asana loses engineering-heavy teams to Jira because Jira's workflow customization and DevOps integrations (Bitbucket, GitHub PR linking, deployment markers) are deeper. Asana retains best with cross-functional teams (marketing × eng × ops) that find Jira too rigid. Counter-play: when destination is Jira, position Asana as the 'connector' across non-eng functions, offer side-by-side deployments (Jira for eng, Asana for everyone else) with clear handoff rituals, and bundle Asana for Goals (OKR) as a Jira-exclusive gap.",
        "metadata": {"source": "Competitor Positioning - Asana vs Jira", "topic": "competitor_positioning", "signals": "competitor_threat,b2b_churn,workflow_depth_gap", "industry": "saas_pm"},
    },
    {
        "id": "competitor_mailchimp_klaviyo",
        "text": "Mailchimp loses ecommerce customers to Klaviyo because Klaviyo's Shopify-native event model and revenue-per-recipient reporting are the category standard. Mailchimp retains best with non-ecommerce SMBs (services, nonprofits, content businesses) that value the easier learning curve. Counter-play: when destination is Klaviyo, do NOT compete on ecommerce automation depth — instead reinforce all-in-one value (email + landing pages + CRM + ads), or actively decline ecommerce ICP fit and lean into your stronger non-ecommerce segments.",
        "metadata": {"source": "Competitor Positioning - Mailchimp vs Klaviyo", "topic": "competitor_positioning", "signals": "competitor_threat,ecommerce_pull,smb_churn,segment_misfit", "industry": "saas_marketing"},
    },
    {
        "id": "competitor_zoom_meet",
        "text": "Zoom loses customers to Google Meet primarily on bundling with Google Workspace, identical to the Slack-vs-Teams pattern. Zoom retains best where webinar features, breakout-room reliability, or non-Workspace customers dominate. Counter-play: when destination is Meet, focus on Zoom Phone + Zoom Contact Center as the bundle defense, surface usage of Webinar/Events features (sunk-cost retention), and offer multi-year pricing locks for accounts considering Workspace migration.",
        "metadata": {"source": "Competitor Positioning - Zoom vs Meet", "topic": "competitor_positioning", "signals": "competitor_threat,bundling_loss,b2b_churn,switching_to_incumbent", "industry": "saas_video"},
    },
    {
        "id": "competitor_figma_sketch",
        "text": "Figma's biggest competitor risk historically was Sketch (and the Adobe acquisition arc); today the real threat is in-house or Penpot for cost-sensitive teams. Figma retains best where multiplayer editing, design systems (Figma Variables), and FigJam adoption have created switching costs. Counter-play: when churn signals are price-driven, push annual prepayment + FigJam bundling rather than seat discounts (which erode price anchor); for security-sensitive accounts, lead with Figma Organization's audit + SSO.",
        "metadata": {"source": "Competitor Positioning - Figma Defense", "topic": "competitor_positioning", "signals": "competitor_threat,price_sensitivity,switching_costs", "industry": "saas_design"},
    },
    {
        "id": "competitor_stripe_square",
        "text": "Stripe loses brick-and-mortar / restaurant / retail accounts to Square because Square bundles hardware, in-person POS, and payroll into one SKU. Stripe retains best with online-first or developer-heavy businesses. Counter-play: when destination is Square, do not retrofit hardware — instead double down on Stripe Terminal partner SDKs, Stripe Connect for marketplaces, and Stripe Billing/Tax automation. For mixed-channel customers, propose a phased coexistence (Square in-person + Stripe online) rather than fighting for both.",
        "metadata": {"source": "Competitor Positioning - Stripe vs Square", "topic": "competitor_positioning", "signals": "competitor_threat,segment_misfit,b2b_churn", "industry": "saas_payments"},
    },
    {
        "id": "competitor_generic_incumbent",
        "text": "When a startup loses customers to an incumbent (Microsoft, Salesforce, Adobe, Google), three patterns dominate: (1) bundle gravity — the buyer already pays the incumbent and treats the startup as redundant cost; (2) procurement risk aversion — 'nobody got fired for buying X'; (3) vendor consolidation pressure during budget cycles. Counter-positioning: pick ONE wedge feature the incumbent cannot match in <12 months, instrument 'irreplaceable usage' (a metric that quantifies dependency), and time renewal conversations to land BEFORE the incumbent's annual budget review.",
        "metadata": {"source": "Competitor Positioning - Generic Incumbent Loss", "topic": "competitor_positioning", "signals": "competitor_threat,bundling_loss,procurement_risk,switching_to_incumbent", "industry": "saas"},
    },
]
