const fs = require('fs');
const path = require('path');
 
const IP_APIs = ['https://api.ipify.org', 'https://icanhazip.com/', 'https://1.1.1.1/cdn-cgi/trace', 'https://cloudflare.com/cdn-cgi/trace', 'https://api.my-ip.io/v2/ip.txt'];
const PATH_CONFIG = path.join(__dirname, 'DDNS_BUNNY_CONFIG.json');

let _config = {};
try {
    _config = JSON.parse(fs.readFileSync(PATH_CONFIG, 'utf8'));
} catch(err) {
    if (err?.toString()?.includes('no such file or directory') === true) {
        _config = {
            current_ip: '',
            nas_url: process.env?.NAS_URL?.replace('https://', '')?.replace('http://', '')?.toLowerCase(),
            bunny_dns_zone_id: process.env?.BUNNY_DNS_ZONE_ID,
            bunny_dns_record_id: process.env?.BUNNY_DNS_RECORD_ID
        }
    } else {
        return callback(new Error(`Cannot read file ${PATH_CONFIG}: ${err.toString()}`));
    }
}

if (!process.env?.BUNNY_ACCESS_KEY) {
    console.error("DynDNS Bunny.net init: the environment variable BUNNY_ACCESS_KEY is not defined");
    return process.exit(1);
}
if (!_config?.nas_url) {
    console.error("DynDNS Bunny.net init: the environment variable NAS_URL is not defined");
    return process.exit(1);
}

if (!_config?.bunny_dns_zone_id || !_config?.bunny_dns_record_id) {
    get_bunny_dns_zone(function (err) {
        if (err) {
            console.log(err.toString());
            return process.exit(1);
        }
        return update_config();
    })
}

process.on('uncaughtException', function (err) {
    console.error("uncaughtException: ", err?.stack);
    return process.exit(1);
});

verifyCurrentIP(0, function(err) {
    if (err) {
        console.log(err.toString());
        return process.exit(1);
    }
    return process.exit(0);
})

function verifyCurrentIP (index, callback) {
    if (index === IP_APIs.length) {
        return callback(new Error('All API are not available, retry later!'));
    }
    return fetch(IP_APIs[index]).then((response) => {
        if (response.ok) {
            return response.text();
        }
        throw new Error(`Status ${response?.status} | ${response?.statusText}`);
    }).then( body => {

        const NEW_IP = get_ip_from_body(body, IP_APIs[index]);

        if (/^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/.test(NEW_IP) === false) {
            console.log(`🔴 GET URL ${IP_APIs[index]} | Result IP format not valid: ${NEW_IP} | Request Body ${body}`);
            return verifyCurrentIP(++index, callback);
        }
        if (_config.current_ip !== NEW_IP) {
            console.log(`UPDATING BUNNY DNS | NEW IP "${NEW_IP}" | OLD IP "${_config.current_ip}"`);
            return update_bunny_dns_record(NEW_IP, function (err) {
                if (err) {
                    return callback(err);
                }
                _config.current_ip = NEW_IP;
                update_config();
                return callback();
            })
        }
        console.log("OK", NEW_IP);
        return callback();
    }).catch(err => {
        console.log(`🔴 GET ${IP_APIs[index]} REQUEST | ${err.toString()}`);
        console.log('Activate Fallback');
        return verifyCurrentIP(++index, callback);
    });   
}

function update_bunny_dns_record(IP, callback) {
    return fetch(`https://api.bunny.net/dnszone/${_config.bunny_dns_zone_id}/records/${_config.bunny_dns_record_id}`, {
        method: 'POST',
        headers: {
            'AccessKey': process.env.BUNNY_ACCESS_KEY,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ "Type": 0, "Value": IP, "Id": _config.bunny_dns_record_id })
    }).then(response => {
        if (response.ok) {
            return callback();
        }
        throw new Error(`Status ${response?.status} | ${response?.statusText}`);
    }).catch(err => {
        return callback(new Error(`🔴 POST BUNNY DNS REQUEST | ${err.toString()}`));
    })
}

function get_bunny_dns_zone(callback) {
    fetch('https://api.bunny.net/dnszone', { headers: { 'AccessKey': process.env.BUNNY_ACCESS_KEY, 'Accept': 'application/json' } }).then((response) => {
        if (response.ok) {
            return response.json();
        }
        throw new Error(`Status ${response?.status} | ${response?.statusText}`);
    }).then(body => {
        const DNS_ZONE = body?.Items?.find(el => _config.nas_url.includes(el?.Domain?.toLowerCase()) === true);
        if (!DNS_ZONE) {
            return callback(new Error(`🔴 GET BUNNY DNS ZONE REQUEST | DNS Zone is not found`)); 
        }
        const DNS_RECORD = DNS_ZONE?.Records?.find(el => _config.nas_url.includes(el?.Name?.toLowerCase()) === true && el.Type === 0);
        if (!DNS_RECORD) {
            return callback(new Error(`🔴 GET BUNNY DNS ZONE REQUEST | DNS Record is not found`)); 
        }
        _config.bunny_dns_zone_id = DNS_ZONE.Id;
        _config.bunny_dns_record_id = DNS_RECORD.Id;
        console.log(`GET BUNNY DNS ZONE REQUEST SUCCEED | ZONE ${_config.bunny_dns_zone_id} | RECORD ${_config.bunny_dns_record_id}`);
        return callback();
    }).catch(err => {
        return callback(new Error(`🔴 GET BUNNY DNS ZONE REQUEST | ${err.toString()}`));
    })
}

function update_config() {
    try {
        fs.writeFileSync(PATH_CONFIG, JSON.stringify(_config));
        console.log(`${PATH_CONFIG} updated!`);
    } catch (err) {
        console.log(new Error(`Cannot update ${PATH_CONFIG}: ${err.toString()}`));
    }
}

function get_ip_from_body(body, url) {
    if (url.startsWith('https://cloudflare') === true || url.startsWith('https://1.1.1.1') === true) {
        return body.split('\n').find(el => el.includes("ip=") === true).replace('ip=', '')
    }
    return body.split('\n')[0];
}