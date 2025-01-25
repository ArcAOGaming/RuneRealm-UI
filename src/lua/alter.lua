-- Name: Alter
-- ProcessId:

local json = require("json")

FactionProcess = 'j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI'

RuneProcess = '4sKr4cf3kvbzFyhM6HmUsYG_Jz9bFZoNUrUX5KoVe0Q'

Name = 'Alter'

LastOffering = LastOffering or {}

IndividualOfferings = IndividualOfferings or {}

TotalOfferings = TotalOfferings or {
    ["Sky Nomads"] = 0,
    ["Aqua Guardians"] = 0,
    ["Stone Titans"] = 0,
    ["Inferno Blades"] = 0
}

function GetTimeDisplay(total_seconds)
    local hours = math.floor(total_seconds / 3600)
    local minutes = math.floor((total_seconds % 3600) / 60)
    local seconds = math.floor(total_seconds % 60)

    -- Create the display message based on hours, minutes, and seconds
    local time_display = ""

    if hours > 0 then
        time_display = hours .. " hour" .. (hours > 1 and "s" or "")
    end

    if minutes > 0 then
        if time_display ~= "" then
            time_display = time_display .. ", "
        end
        time_display = time_display .. minutes .. " minute" .. (minutes > 1 and "s" or "")
    end

    if seconds > 0 then
        if time_display ~= "" then
            time_display = time_display .. " and "
        end
        time_display = time_display .. seconds .. " second" .. (seconds > 1 and "s" or "")
    end

    -- Handle cases where time is exactly zero minutes or seconds
    if time_display == "" then
        time_display = "0 seconds"
    end

    return time_display
end

-- Function to get the current day from a Unix timestamp
function GetDay(timestamp)
    --Convert Timestamp to seconds
    local unix_timestamp = timestamp / 1000
    -- Number of seconds in a day
    local seconds_in_a_day = 86400
    -- Calculate the number of days since Unix epoch
    local current_day = math.floor(unix_timestamp / seconds_in_a_day)
    local remaining_seconds = unix_timestamp % seconds_in_a_day
    return current_day, math.ceil((seconds_in_a_day - remaining_seconds))
end

Handlers.add(
    'DefaultInteraction',
    Handlers.utils.hasMatchingTag('Action', 'DefaultInteraction'),
    function(msg)
        print('DefaultInteraction - Confirming Factions')
        ao.send({
            Target = FactionProcess,
            Tags = {
                Action = 'GetUserInfo',
                Wallet = msg.From
            },
        })
    end
)

Handlers.add(
    'GetUserInfo-Response',
    Handlers.utils.hasMatchingTag('Action', 'GetUserInfo-Response'),
    function(msg)
        print('GetUserInfo-Response')
        assert(msg.From == FactionProcess, "GetUserInfo-Response received from invalid process.")

        local decodedData = json.decode(msg.Data)

        local validUser = decodedData.isUnlocked
        if not validUser then
            print("GetUserInfo-Response received from invalid user.")
            return
        end

        print("GetUserInfo-Response received from valid user.")

        local faction = decodedData.faction
        local day, remaining = GetDay(msg.Timestamp)
        local userId = msg.Tags.UserId

        print("Checking user: " .. userId)
        if not LastOffering[userId] or not IndividualOfferings[userId] then
            LastOffering[userId] = 0
            IndividualOfferings[userId] = 0
        end

        if LastOffering[userId] < day then
            LastOffering[userId] = day
            IndividualOfferings[userId] = IndividualOfferings[userId] + 1

            TotalOfferings[faction] = TotalOfferings[faction] + 1
            ao.send({
                Target = FactionProcess,
                Tags = {
                    Action = "Offered-Praise",
                    TotalOfferings = tostring(TotalOfferings[faction])
                }
            })
            ao.send({
                Target = RuneProcess,
                Action = "Grant",
                Quantity = "1",
                Recipient = userId,
            })
        else
            ao.send({
                Target = userId,
                Tags = {
                    Action = "Failed-Offer-Praise",
                },
                Data = json.encode({
                    TimeRemaining = GetTimeDisplay(remaining)
                })
            })
        end
    end
)

Handlers.add(
    'GetUserOfferings',
    Handlers.utils.hasMatchingTag('Action', 'GetUserOfferings'),
    function(msg)
        print('GetUserOfferings')
        local userId = msg.Tags.UserId
        ao.send({
            Target = msg.From,
            Tags = {
                Action = "GetUserOfferings-Response",
            },
            Data = json.encode(IndividualOfferings[userId])
        })
    end
)

Handlers.add(
    'GetTotalOfferings',
    Handlers.utils.hasMatchingTag('Action', 'GetTotalOfferings'),
    function(msg)
        print('GetTotalOfferings')
        ao.send({
            Target = msg.From,
            Tags = {
                Action = "GetTotalOfferings-Response",
            },
            Data = json.encode(TotalOfferings)
        })
    end
)
print("Alter initialized")