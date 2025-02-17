import { parse } from "node-html-parser"

export const STREAM_STATUS = {
    OFFLINE: 1,
    INDETERMINATE: 2,
    STARTING_SOON: 3,
    LIVE: 4,
}

function createPollRoute(channelID) {
    return `https://www.youtube.com/channel/${channelID}/live`
}

function validateVideoLink(anyLink) {
    if (anyLink.match(/watch\?v=/)) {
        return anyLink
    }
}

export async function fetchLivestreamPage(channelID) {
    try {
        const res = await fetch(createPollRoute(channelID))
        if (res.status !== 200) {
            return { error: `HTTP status: ${res.status}`, result: null }
        }
        const youtubeHTML = await res.text()
        return { error: null, result: youtubeHTML }
    } catch (e) {
        return { error: e.toString(), result: null }
    }
}

const VIDEO_INFO_EXPECT_START = "var ytInitialPlayerResponse = "
export function extractLivestreamInfo(fromPageContent) {
    const dom = parse(fromPageContent, {
        blockTextElements: {
            script: true,
            noscript: false,
            style: false,
            pre: false,
        }
    })

    const canonical = dom.querySelector("link[rel='canonical']")
    if (!canonical) {
        return { error: "Malformed HTML", result: null } 
    }

    const videoLink = validateVideoLink(canonical.getAttribute("href"))
    if (!videoLink) {
        return { error: null, result: { live: STREAM_STATUS.OFFLINE, title: null, videoLink: null, streamStartTime: null, thumbnail: null } }
    } 

    const liveTitle = dom.querySelector("meta[name='title']").getAttribute("content")
    const basicResponse = { error: null, result: { live: STREAM_STATUS.INDETERMINATE, title: liveTitle, videoLink, streamStartTime: null, thumbnail: null } }

    const scripts = dom.querySelectorAll("script")
    let playerInfo = null
    for (let i = 0; i < scripts.length; ++i) {
        const text = scripts[i].textContent
        
        if (text.startsWith(VIDEO_INFO_EXPECT_START)) {
            try {
                playerInfo = JSON.parse(text.substring(VIDEO_INFO_EXPECT_START.length, text.length - 1))
            } catch {
                continue
            }
            break
        }
    }

    if (!playerInfo) {
        return basicResponse
    }

    // Check if stream frame is actually live, or just a waiting room
    const videoDetails = playerInfo.videoDetails
    if (videoDetails?.isLiveContent && videoDetails?.isUpcoming) {
        basicResponse.result.live = STREAM_STATUS.STARTING_SOON
    } else if (videoDetails?.isLiveContent && !videoDetails?.isUpcoming) {
        basicResponse.result.live = STREAM_STATUS.LIVE
    }

    // Check stream frame start time
    // If it's more than one hour out, act as if it was offline
    const ts = playerInfo.playabilityStatus?.
        liveStreamability?.liveStreamabilityRenderer?.offlineSlate?.
        liveStreamOfflineSlateRenderer?.scheduledStartTime
    if (ts !== undefined) {
        const expectedStartTime = parseInt(ts) * 1000
        const waitTimeLeftMS = expectedStartTime - (new Date().getTime())
        basicResponse.result.streamStartTime = new Date(expectedStartTime)
        if (waitTimeLeftMS > 1800 * 1000) {
            basicResponse.result.live = STREAM_STATUS.OFFLINE
        }
    }

    const thumbnailArray = playerInfo.videoDetails?.thumbnail?.thumbnails
    if (thumbnailArray !== undefined && Array.isArray(thumbnailArray)) {
        for (let i = 0; i < thumbnailArray.length; ++i) {
            const t = thumbnailArray[i]
            if (typeof t.width === "number" && t.width > 300 &&
                typeof t.height === "number" && t.height > 150) {
                basicResponse.result.thumbnail = t.url
                break
            }
        }
    }

    return basicResponse
}

export async function pollLivestreamStatus(channelID) {
    const { error, result: youtubeHTML } = await fetchLivestreamPage(channelID)
    if (error) {
        return { error, result: null }
    }

    return extractLivestreamInfo(youtubeHTML)   
}

export async function pollLivestreamStatusDummy(unused, selectMock) {
    const fakeResult = { 
        live: STREAM_STATUS.OFFLINE, 
        title: "Dummy dummy dummy dummy", 
        videoLink: "https://www.youtube.com/watch?v=aaaaaaaaaaa", 
        thumbnail: "https://i.ytimg.com/vi/NFYUWfIzGyI/hqdefault_live.jpg?sqp=CNyX0YwG-oaymwEjCNACELwBSFryq4qpAxUIARUAAAAAGAElAADIQj0AgKJDeAE=&rs=AOn4CLCxZ1e-GDf_bdonIkYXkD4mNWkXIA",
        streamStartTime: new Date(Date.now() + 3600000)
    }

    switch (selectMock) {
        case "error": return { error: "Fake Error", result: null }
        case "nostream": return { error: null, result: { live: STREAM_STATUS.OFFLINE, title: null, videoLink: null, streamStartTime: null } }
        case "degraded":
            fakeResult.live = STREAM_STATUS.INDETERMINATE
            fakeResult.streamStartTime = null
            fakeResult.thumbnail = null
            return { error: null, result: fakeResult }
        case "farout":
            fakeResult.live = STREAM_STATUS.OFFLINE
            return { error: null, result: fakeResult }
        case "soon":
            fakeResult.live = STREAM_STATUS.STARTING_SOON
            return { error: null, result: fakeResult }
        case "live":
        default:
            fakeResult.live = STREAM_STATUS.LIVE
            return { error: null, result: fakeResult }
    }   
}