// creates the Nav buttons for the home screen
import {Link} from "react-router";
import styled from 'styled-components';

const NavWrapper = styled.div`
    top: 59%;
    position: relative;
    z-index: 10;
`;

const NavStyle = styled.nav`
    position: absolute;

`;

const UlStyle = styled.ul`
    margin-top: 2%;
    list-style: none;
    display: flex;
    flex-direction: column;
`;

const LiStyle = styled.li`
    border: 5px solid #d2e357;
    border-radius: 10px;
    transition: background-color 0.2s ease-in-out;
    text-align: center;
    margin-top: 3%;
    display: flex;

    &:hover {
        background-color: #d2e357;
    }
`

const LinkStyle = styled(Link)`
    flex: 1;
    padding: 0.1em 0.8em;
    text-decoration: none;
    color: #105173;
    text-shadow: 1px 1px #072b40, -1px -1px #f8fbfd;
    font-size: calc(2px + 3.3vw);
`

export default function NavHome(){
    return(
        <NavWrapper>
            <NavStyle>
                <UlStyle>
                    <LiStyle>
                        <LinkStyle to={'/paint'}>Action Paint</LinkStyle>
                    </LiStyle>
                    <LiStyle>
                        <LinkStyle to = {'/fingerpaint'}>Finger Paint</LinkStyle>
                    </LiStyle>
                    <LiStyle>
                        <LinkStyle to={'/gallery'}>Gallery</LinkStyle>
                    </LiStyle>
                </UlStyle>
            </NavStyle>
        </NavWrapper>
    )
}